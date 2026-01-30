import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import path from 'path';

puppeteer.use(StealthPlugin());

// Use a persistent browser profile directory - this saves EVERYTHING
const USER_DATA_DIR = path.join(process.cwd(), 'browser_profile');
const POLYMARKET_URL = 'https://polymarket.com/portfolio';

// Selectors from the provided files
const CLAIM_SELECTORS = [
    '#__pm_layout > div > div.fresnel-container.fresnel-greaterThanOrEqual-lg.fresnel-_r_18_.contents > div > div > div > button',
];

const CLAIM_XPATHS = [
    '//*[@id="__pm_layout"]/div/div[3]/div/div/div/button',
];

async function clickClaimProceedsInModal(page) {
    // Wait for the modal to appear
    console.log('[INFO] Waiting for modal to appear...');
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Try to find "Claim proceeds" button in the modal
    try {
        const claimProceedsButton = await page.evaluateHandle(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            return buttons.find(btn => {
                const text = btn.textContent?.toLowerCase() || '';
                return text.includes('claim proceeds') || text.includes('claim winnings');
            });
        });

        if (claimProceedsButton && claimProceedsButton.asElement()) {
            const buttonText = await page.evaluate(el => el.textContent, claimProceedsButton);
            console.log(`[INFO] Found "Claim proceeds" button in modal: "${buttonText}"`);
            await claimProceedsButton.click();
            console.log('[SUCCESS] Clicked "Claim proceeds" button!');
            console.log('[INFO] Waiting for "Done" button to appear...');

            // Wait for the "Done" button to appear (with timeout)
            const maxWaitTime = 120000; // 2 minutes max
            const startTime = Date.now();
            let doneButtonFound = false;

            while (Date.now() - startTime < maxWaitTime && !doneButtonFound) {
                await new Promise(resolve => setTimeout(resolve, 2000)); // Check every 2 seconds

                try {
                    const doneButton = await page.evaluateHandle(() => {
                        const buttons = Array.from(document.querySelectorAll('button'));
                        return buttons.find(btn => {
                            const text = btn.textContent?.trim().toLowerCase() || '';
                            return text === 'done';
                        });
                    });

                    if (doneButton && doneButton.asElement()) {
                        console.log('[SUCCESS] Found "Done" button!');
                        await doneButton.click();
                        console.log('[SUCCESS] Clicked "Done" button!');
                        doneButtonFound = true;
                        await new Promise(resolve => setTimeout(resolve, 2000)); // Brief wait after clicking Done
                    }
                } catch (error) {
                    // Continue waiting
                }
            }

            if (!doneButtonFound) {
                console.log('[WARN] "Done" button did not appear within timeout period');
            }

            return true;
        }
    } catch (error) {
        console.log('[WARN] Error finding Claim proceeds button:', error.message);
    }

    console.log('[INFO] No "Claim proceeds" button found in modal.');
    return false;
}

async function findAndClickClaimButton(page) {
    // Try CSS selectors first
    for (const selector of CLAIM_SELECTORS) {
        try {
            const button = await page.$(selector);
            if (button) {
                const buttonText = await page.evaluate(el => el.textContent, button);
                if (buttonText && buttonText.toLowerCase().includes('claim')) {
                    console.log(`[INFO] Found claim button with selector: ${selector}`);
                    console.log(`[INFO] Button text: ${buttonText}`);
                    await button.click();
                    console.log('[SUCCESS] Clicked claim button!');

                    // Step 2: Click "Claim proceeds" in the modal
                    await clickClaimProceedsInModal(page);
                    return true;
                }
            }
        } catch (error) {
            // Selector didn't work, try next
        }
    }

    // Try XPath selectors
    for (const xpath of CLAIM_XPATHS) {
        try {
            const elements = await page.$x(xpath);
            if (elements.length > 0) {
                const button = elements[0];
                const buttonText = await page.evaluate(el => el.textContent, button);
                if (buttonText && buttonText.toLowerCase().includes('claim')) {
                    console.log(`[INFO] Found claim button with xpath: ${xpath}`);
                    console.log(`[INFO] Button text: ${buttonText}`);
                    await button.click();
                    console.log('[SUCCESS] Clicked claim button!');

                    // Step 2: Click "Claim proceeds" in the modal
                    await clickClaimProceedsInModal(page);
                    return true;
                }
            }
        } catch (error) {
            // XPath didn't work, try next
        }
    }

    // Try generic text-based search as fallback
    try {
        const claimButton = await page.evaluateHandle(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            return buttons.find(btn => btn.textContent?.toLowerCase().includes('claim'));
        });

        if (claimButton && claimButton.asElement()) {
            const buttonText = await page.evaluate(el => el.textContent, claimButton);
            console.log(`[INFO] Found claim button via text search: "${buttonText}"`);
            await claimButton.click();
            console.log('[SUCCESS] Clicked claim button!');

            // Step 2: Click "Claim proceeds" in the modal
            await clickClaimProceedsInModal(page);
            return true;
        }
    } catch (error) {
        // Text search didn't work
    }

    console.log('[INFO] No claim button found on this page.');
    return false;
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
