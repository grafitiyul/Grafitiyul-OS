-- Weekend/holiday pay rule finalized: 50% of the entry's calculated base
-- payment, driven by the EXISTING canonical שבת/חג detector (CRM settings —
-- SabbathWeeklyRule/HolidayRule via sabbathHolidayWindow). No fixed configured
-- amount, no second calendar. Data-only change: repoint the system component's
-- auto-rule and replace the misleading fixed-amount config with the multiplier.
-- Existing PayrollEntryLine rows are untouched — stored calculations never
-- change retroactively.
UPDATE "PayrollComponent"
SET "autoRule" = 'weekend_holiday_percent_of_base',
    "config" = '{"multiplier": 0.5}'
WHERE "key" = 'weekend_holiday';
