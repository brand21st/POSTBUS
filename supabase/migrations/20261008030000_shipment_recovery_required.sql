-- Ambiguous CEPT outcomes (timeout / unrecognized provider response) must not
-- become claimable FAILED. RECOVERY_REQUIRED is track-only until tracking
-- resolves the article or an explicit confirmed-not-booked transition requeues.

alter type public.shipment_status add value if not exists 'RECOVERY_REQUIRED';
