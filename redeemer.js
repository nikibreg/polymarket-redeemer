import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import path from 'path';

puppeteer.use(StealthPlugin());

// Use a persistent browser profile directory - this saves EVERYTHING
const USER_DATA_DIR = path.join(process.cwd(), 'browser_profile');
const POLYMARKET_URL = 'https://polymarket.com/portfolio';

async function takeDebugScreenshot(page, label) {
    try {
        const screenshotPath = path.join(process.cwd(), `debug_${label}_${Date.now()}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true });
        console.log(`[DEBUG] Screenshot saved: ${screenshotPath}`);
    } catch (e) {
        console.log('[DEBUG] Failed to save screenshot:', e.message);
    }
}

async function logAllButtons(page, context) {
    const allButtons = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('button')).map(btn => ({
            text: btn.textContent?.trim().substring(0, 80),
            visible: btn.offsetParent !== null,
            disabled: btn.disabled,
            tag: btn.tagName,
            // Check if button is inside a link (which would navigate)
            insideLink: !!btn.closest('a'),
            parentTag: btn.parentElement?.tagName,
        }));
    });
    console.log(`[DEBUG] Buttons (${context}):`, JSON.stringify(allButtons, null, 2));
}

async function waitForButtonAndClick(page, matchFn, label, timeoutMs = 120000) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
        try {
            const button = await page.evaluateHandle(matchFn);
            if (button && button.asElement()) {
                const info = await page.evaluate(el => ({
                    text: el.textContent?.trim(),
                    disabled: el.disabled,
                }), button);
                console.log(`[SUCCESS] Found "${label}" button: "${info.text}"`);
                await button.click();
                console.log(`[SUCCESS] Clicked "${label}" button!`);
                return true;
            }
        } catch (e) {
            // ignore, retry
        }
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        if (elapsed > 0 && elapsed % 10 === 0) {
            console.log(`[DEBUG] Still waiting for "${label}" button (${elapsed}s)...`);
            await logAllButtons(page, `waiting-${label}-${elapsed}s`);
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
    console.log(`[WARN] "${label}" button did not appear within ${timeoutMs / 1000}s`);
    await takeDebugScreenshot(page, `no_${label}`);
    return false;
}

async function findAndClickClaimButton(page) {
    await takeDebugScreenshot(page, 'before_claim');
    await logAllButtons(page, 'portfolio-page');

    // Log current URL to detect unexpected navigation
    const currentUrl = page.url();
    console.log(`[DEBUG] Current URL: ${currentUrl}`);

    // Step 1: Find and click the initial "Claim" button on the portfolio page.
    // This is the "Markets Won" banner button. We must be very precise:
    // - Match buttons whose DIRECT text is "Claim" or "Claim $..." (short text)
    // - Exclude buttons inside <a> tags (those are navigation links to markets)
    // - Exclude buttons with long text (those are market position cards, not action buttons)
    const bannerClaimClicked = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        for (const btn of buttons) {
            const text = btn.textContent?.trim() || '';
            const lower = text.toLowerCase();

            // Skip buttons inside anchor tags (those navigate to market pages)
            if (btn.closest('a')) continue;

            // Skip invisible buttons
            if (!btn.offsetParent) continue;

            // Match: exact "Claim", "Claim $X.XX", "Claim Proceeds", "Claim Winnings"
            // Must start with "claim" and be short (banner buttons are concise)
            const isClaimButton = (
                lower === 'claim' ||
                lower.startsWith('claim $') ||
                lower === 'claim proceeds' ||
                lower === 'claim winnings' ||
                lower === 'claim all'
            );

            if (isClaimButton) {
                // Extra safety: claim banner buttons are short, not long market descriptions
                if (text.length > 40) continue;
                btn.click();
                return { clicked: true, text };
            }
        }
        return { clicked: false };
    });

    if (!bannerClaimClicked.clicked) {
        // Fallback: also check for links/divs that act as claim buttons
        const fallbackClicked = await page.evaluate(() => {
            // Some UIs use <a> or <div> styled as buttons for the claim action
            const allClickable = Array.from(document.querySelectorAll('button, [role="button"]'));
            for (const el of allClickable) {
                const text = el.textContent?.trim() || '';
                const lower = text.toLowerCase();
                if (!el.offsetParent) continue;
                if (text.length > 40) continue;

                if (lower === 'claim' || lower.startsWith('claim $') || lower === 'claim proceeds' || lower === 'claim winnings' || lower === 'claim all') {
                    el.click();
                    return { clicked: true, text };
                }
            }
            return { clicked: false };
        });

        if (!fallbackClicked.clicked) {
            console.log('[INFO] No claim button found on the portfolio page.');
            return false;
        }
        console.log(`[SUCCESS] Clicked claim button (fallback): "${fallbackClicked.text}"`);
    } else {
        console.log(`[SUCCESS] Clicked claim banner button: "${bannerClaimClicked.text}"`);
    }

    // Step 2: Wait for modal and click "Claim" / "Claim Proceeds" inside it
    console.log('[INFO] Waiting for claim modal to appear...');
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Check if we accidentally navigated away from portfolio
    const urlAfterClick = page.url();
    if (!urlAfterClick.includes('/portfolio')) {
        console.log(`[WARN] Navigated away to: ${urlAfterClick}`);
        console.log('[INFO] Wrong button clicked (navigated to market page). Going back to portfolio...');
        await page.goto(POLYMARKET_URL, { waitUntil: 'networkidle2', timeout: 60000 });
        await new Promise(resolve => setTimeout(resolve, 5000));
        await takeDebugScreenshot(page, 'returned_to_portfolio');
        return false;
    }

    await takeDebugScreenshot(page, 'after_banner_click');
    await logAllButtons(page, 'after-banner-click');

    // Look for the modal "Claim" button
    const modalClaimClicked = await page.evaluate(() => {
        // Prioritize buttons inside modal/dialog containers
        const modalSelectors = [
            '[role="dialog"]',
            '[class*="modal" i]',
            '[class*="Modal"]',
            '[class*="overlay" i]',
            '[class*="Overlay"]',
            '[class*="dialog" i]',
            '[class*="Dialog"]',
            '[class*="drawer" i]',
            '[class*="Drawer"]',
            '[class*="popup" i]',
            '[class*="Popup"]',
        ];

        // First try: button inside a modal container
        for (const selector of modalSelectors) {
            const containers = document.querySelectorAll(selector);
            for (const container of containers) {
                const buttons = Array.from(container.querySelectorAll('button, [role="button"]'));
                for (const btn of buttons) {
                    const text = btn.textContent?.trim().toLowerCase() || '';
                    if (text === 'claim' || text === 'claim proceeds' || text === 'claim winnings' || text.startsWith('claim $') || text === 'claim all') {
                        if (btn.disabled) continue;
                        btn.click();
                        return { clicked: true, text: btn.textContent?.trim(), method: 'modal' };
                    }
                }
            }
        }

        // Second try: any visible claim button (modal might not use standard classes)
        const allButtons = Array.from(document.querySelectorAll('button, [role="button"]'));
        for (const btn of allButtons) {
            const text = btn.textContent?.trim().toLowerCase() || '';
            if (!btn.offsetParent) continue;
            if (btn.disabled) continue;
            if (text === 'claim' || text === 'claim proceeds' || text === 'claim winnings' || text === 'claim all') {
                btn.click();
                return { clicked: true, text: btn.textContent?.trim(), method: 'fallback' };
            }
        }

        return { clicked: false };
    });

    if (modalClaimClicked.clicked) {
        console.log(`[SUCCESS] Clicked modal Claim button (${modalClaimClicked.method}): "${modalClaimClicked.text}"`);
    } else {
        console.log('[INFO] No Claim button found in modal. The banner click may have been sufficient.');
    }

    // Step 3: Wait for "Done" button
    console.log('[INFO] Waiting for "Done" button to appear...');
    const doneClicked = await waitForButtonAndClick(page, () => {
        const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
        return buttons.find(btn => {
            const text = btn.textContent?.trim().toLowerCase() || '';
            return text === 'done' && btn.offsetParent;
        });
    }, 'Done', 120000);

    if (doneClicked) {
        console.log('[INFO] Reloading portfolio to update balance...');
        await new Promise(resolve => setTimeout(resolve, 2000));
        await page.goto(POLYMARKET_URL, { waitUntil: 'networkidle2', timeout: 60000 });
        await new Promise(resolve => setTimeout(resolve, 3000));
        console.log('[SUCCESS] Portfolio reloaded with updated balance.');
    }

    return true;
}

async function checkIfLoggedIn(page) {
    const isLoggedIn = await page.evaluate(() => {
        // Look for logged-in indicators (positive signals)

        // 1. Check for portfolio value display (only shows when logged in)
        const hasPortfolioValue = document.body.innerText.includes('Portfolio Value') ||
            document.body.innerText.includes('Available Balance');

        // 2. Check for user avatar/profile picture (typically in header when logged in)
        const hasAvatar = document.querySelector('img[alt*="avatar" i]') !== null ||
            document.querySelector('img[alt*="profile" i]') !== null ||
            document.querySelector('[class*="avatar" i]') !== null ||
            document.querySelector('[class*="Avatar" i]') !== null;

        // 3. Check for deposit/withdraw buttons (only show when logged in)
        const buttons = Array.from(document.querySelectorAll('button'));
        const hasDepositWithdraw = buttons.some(btn => {
            const text = btn.textContent?.toLowerCase() || '';
            return text.includes('deposit') || text.includes('withdraw');
        });

        // 4. Check for positions or history tab content
        const hasPositions = document.body.innerText.includes('Positions') ||
            document.body.innerText.includes('History');

        // 5. Check for a prominent "Log In" or "Sign Up" button in the header area
        const headerButtons = Array.from(document.querySelectorAll('header button, nav button, [class*="header" i] button, [class*="nav" i] button'));
        const hasLoginButtonInHeader = headerButtons.some(btn => {
            const text = btn.textContent?.trim().toLowerCase() || '';
            return text === 'log in' || text === 'sign in' || text === 'sign up' || text === 'connect wallet';
        });

        // If there's a login button prominently in the header, we're not logged in
        if (hasLoginButtonInHeader) {
            return false;
        }

        // If we have any positive logged-in signals, we're logged in
        return hasPortfolioValue || hasAvatar || hasDepositWithdraw || hasPositions;
    });
    return isLoggedIn;
}

async function runClaimCheck() {
    console.log(`\n[${new Date().toISOString()}] Starting claim check...`);

    const browser = await puppeteer.launch({
        headless: false,
        userDataDir: USER_DATA_DIR,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        defaultViewport: { width: 1280, height: 800 },
    });

    try {
        const page = await browser.newPage();
        await page.goto(POLYMARKET_URL, { waitUntil: 'networkidle2', timeout: 60000 });
        await new Promise(resolve => setTimeout(resolve, 5000));

        const isLoggedIn = await checkIfLoggedIn(page);
        console.log(`[DEBUG] Login status: ${isLoggedIn}`);

        if (!isLoggedIn) {
            console.log('[INFO] Not logged in. Please log in via the browser window...');
            // Poll until the user logs in manually
            const loginTimeout = 5 * 60 * 1000; // 5 minutes
            const loginStart = Date.now();
            let loggedIn = false;

            while (Date.now() - loginStart < loginTimeout) {
                await new Promise(resolve => setTimeout(resolve, 3000));
                try {
                    loggedIn = await checkIfLoggedIn(page);
                    if (loggedIn) {
                        console.log('[SUCCESS] Login detected!');
                        break;
                    }
                } catch {
                    // page may have navigated, reload portfolio
                    try {
                        await page.goto(POLYMARKET_URL, { waitUntil: 'networkidle2', timeout: 60000 });
                        await new Promise(resolve => setTimeout(resolve, 3000));
                    } catch {
                        // ignore
                    }
                }
            }

            if (!loggedIn) {
                console.log('[WARN] Login timed out after 5 minutes. Exiting.');
                await browser.close();
                return;
            }
        }

        console.log('[INFO] Session valid, checking for claim buttons...');

        // Try to find and click claim button
        const clicked = await findAndClickClaimButton(page);

        if (clicked) {
            // Give a brief moment for any final UI updates
            await new Promise(resolve => setTimeout(resolve, 3000));
        }

    } catch (error) {
        console.error('[ERROR] Claim check failed:', error.message);
    } finally {
        // Close all tabs and clean up browser
        try {
            const pages = await browser.pages();
            for (const page of pages) {
                await page.close();
            }
        } catch (e) {
            // Ignore errors during cleanup
        }
        await browser.close();
    }
}

// Candle close times: :05, :20, :35, :50 minutes past the hour
const CANDLE_CLOSE_MINUTES = [4, 19, 34, 49];

function getNextCheckTime() {
    const now = new Date();
    const currentMinute = now.getMinutes();

    // Find the next candle close minute
    let nextMinute = CANDLE_CLOSE_MINUTES.find(m => m > currentMinute);
    let hoursToAdd = 0;

    if (nextMinute === undefined) {
        // Wrap to next hour
        nextMinute = CANDLE_CLOSE_MINUTES[0];
        hoursToAdd = 1;
    }

    const nextCheck = new Date(now);
    nextCheck.setHours(now.getHours() + hoursToAdd);
    nextCheck.setMinutes(nextMinute);
    nextCheck.setSeconds(0);
    nextCheck.setMilliseconds(0);

    return nextCheck;
}

function scheduleNextCheck() {
    const nextCheck = getNextCheckTime();
    const now = new Date();
    const delayMs = nextCheck.getTime() - now.getTime();

    console.log(`[INFO] Next check scheduled at ${nextCheck.toLocaleTimeString()} (in ${Math.round(delayMs / 1000 / 60)} minutes)`);

    setTimeout(async () => {
        await runClaimCheck();
        scheduleNextCheck(); // Schedule the next one
    }, delayMs);
}

async function main() {
    console.log('======================================================');
    console.log(' Polymarket Auto-Claimer');
    console.log(' Checking at candle closes: :04, :19, :34, :49');
    console.log(' Using persistent browser profile for session');
    console.log('======================================================\n');

    // Initial check
    await runClaimCheck();

    // Schedule recurring checks aligned to candle closes
    scheduleNextCheck();
}

main().catch(console.error);
