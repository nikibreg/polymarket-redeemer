import { $ } from 'bun';

const CHECK_MINUTES = [4, 19, 34, 49];

async function getWalletAddress() {
    const result = await $`polymarket wallet address`.text();
    const match = result.match(/0x[a-fA-F0-9]{40}/);
    if (!match) throw new Error(`Could not get wallet address: ${result.trim()}`);
    return match[0];
}

async function getPositions(address) {
    const result = await $`polymarket data positions ${address} --limit 100 -o json`.text();
    try {
        return JSON.parse(result);
    } catch {
        console.log('[DEBUG] Positions response:', result.trim());
        return [];
    }
}

async function redeemPosition(conditionId) {
    console.log(`[INFO] Redeeming condition ${conditionId}...`);
    try {
        const result = await $`polymarket ctf redeem --condition ${conditionId}`.text();
        console.log(`[SUCCESS] ${result.trim()}`);
        return true;
    } catch (e) {
        // Try neg-risk redemption as fallback
        console.log(`[INFO] Standard redeem failed, trying neg-risk...`);
        try {
            const result = await $`polymarket ctf redeem-neg-risk --condition ${conditionId} --amounts "1"`.text();
            console.log(`[SUCCESS] ${result.trim()}`);
            return true;
        } catch (e2) {
            console.log(`[WARN] Could not redeem ${conditionId}: ${e2.message}`);
            return false;
        }
    }
}

async function runClaimCheck() {
    console.log(`\n[${new Date().toISOString()}] Starting claim check...`);

    try {
        const address = await getWalletAddress();
        console.log(`[INFO] Wallet: ${address}`);

        const positions = await getPositions(address);
        if (!Array.isArray(positions) || positions.length === 0) {
            console.log('[INFO] No positions found.');
            return;
        }

        console.log(`[INFO] Found ${positions.length} position(s).`);

        // Filter for resolved/redeemable positions
        const redeemable = positions.filter(p =>
            p.resolved || p.redeemable || p.status === 'resolved' || p.outcome !== undefined
        );

        if (redeemable.length === 0) {
            console.log('[INFO] No redeemable positions.');
            return;
        }

        console.log(`[INFO] ${redeemable.length} redeemable position(s) found.`);

        for (const position of redeemable) {
            const conditionId = position.conditionId || position.condition_id || position.condition;
            if (!conditionId) {
                console.log('[WARN] Position missing condition ID:', JSON.stringify(position));
                continue;
            }
            await redeemPosition(conditionId);
        }
    } catch (error) {
        console.error('[ERROR] Claim check failed:', error.message);
    }
}

function getNextCheckTime() {
    const now = new Date();
    const currentMinute = now.getMinutes();

    let nextMinute = CHECK_MINUTES.find(m => m > currentMinute);
    let hoursToAdd = 0;

    if (nextMinute === undefined) {
        nextMinute = CHECK_MINUTES[0];
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
    const delayMs = nextCheck.getTime() - Date.now();

    console.log(`[INFO] Next check at ${nextCheck.toLocaleTimeString()} (in ${Math.round(delayMs / 1000 / 60)} min)`);

    setTimeout(async () => {
        await runClaimCheck();
        scheduleNextCheck();
    }, delayMs);
}

async function main() {
    console.log('======================================================');
    console.log(' Polymarket Auto-Redeemer (CLI)');
    console.log(' Checking at candle closes: :04, :19, :34, :49');
    console.log(' Using: polymarket ctf redeem');
    console.log('======================================================\n');

    await runClaimCheck();
    scheduleNextCheck();
}

main().catch(console.error);
