// COMPRESSERWEZEREND/scheduler.ts
import cron from 'node-cron';
import { db } from "./database/DBService";

const expireAMCContracts = async () => {
    console.log('🔄 Running AMC expiration check...', new Date().toISOString());
    
    try {
        const result = await db.queryWrite(`
            UPDATE amc_contract 
            SET is_expired = true 
            WHERE end_date < CURRENT_DATE 
            AND is_expired = false 
            AND is_renewed = false
        `);
        
        console.log(`✅ Contracts expiration updated successfully`);
        
        // Agar row count check karna ho to
        if (Array.isArray(result)) {
            console.log(`📊 Affected rows: ${result.length}`);
        }
    } catch (error) {
        console.error('❌ Error updating AMC contracts:', error);
    }
};

// ✅ PRODUCTION: Daily 2 AM IST (24 hours mein ek baar)
cron.schedule('0 2 * * *', expireAMCContracts, {
    timezone: "Asia/Kolkata"
});

console.log('🚀 AMC Scheduler started. Will run daily at 2 AM IST');

