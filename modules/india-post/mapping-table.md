# India Post booking field mapping

Source of truth: India Post External Integrations Approach Document (updated 30.07.2026). Field names are CEPT process-articles names.

Do not invent, rename, or silently default values. OTP is TRUE only for 24_SPP_PARSPL.

| India Post Field | Postbus Source | Transformation | Required | Validation |
|------------------|----------------|----------------|----------|------------|
| bulk_customer_id | Store Configuration | india_post_connections.bulk_customer_id as 10-digit string | mandatory | Number, length 10 |
| contract_id | Store Configuration | india_post_contracts.contract_id for selected service; never from Shopify/UI | mandatory | Number, length 8 |
| barcode_no | System Generated | S10 from barcode_ranges, or Excel BARCODE NO after uniqueness + check-digit checks | mandatory | 13 characters, S10 |
| pickup_or_dropoff | Shipping Configuration | DROPOFF unless pickup is explicitly enabled; Excel PICKUP ADDRESS FLAG | mandatory | PICKUP or DROPOFF |
| pickup_dropoff_office_id | India Post API derived | Saved office id resolved via pincode-search; never invented | mandatory | 8-digit number; delivery_office_flag true; office_type_code not BPO |
| article_type | Store Configuration | Postbus service → CEPT article_type SP_INLAND_PARCEL (Speed Post Parcel Domestic) or BUSINESS_PARCEL; NDD codes unchanged | mandatory | Documented product codes only |
| physical_weight | Package Configuration | Shopify/Postbus grams rounded to a whole number; Excel PHYSICAL WEIGHT | mandatory | Whole number 1–35000 grams |
| shape_of_article | Package Configuration | Excel SHAPE OF ARTICLE, or NROL for SP_INLAND_PARCEL / BUSINESS_PARCEL at any legal weight (not a 500 g cutoff); DOC only for document products | mandatory | ROLL, NROL, or DOC |
| length | Package Configuration | Shipment/Excel cm; 0 only when the article is not a parcel | mandatory | Numeric cm; article-type min/max from tariff tables |
| breadth_diameter | Package Configuration | Shipment width_cm or Excel BREADTH/DIAMETER | mandatory | Numeric cm; article-type min/max from tariff tables |
| height | Package Configuration | Shipment height_cm or Excel HEIGHT | mandatory | Numeric cm; article-type min/max from tariff tables |
| priority_flag | Optional | Excel PRIORITY FLAG or empty | optional | TRUE or FALSE |
| delivery_instruction | Optional | Excel DELIVERY INSTRUCTION | optional | ND, OD, or SD |
| delivery_slot | Optional | Excel if present; otherwise empty | optional | 9am-2pm, 2pm-5pm, or 5pm-8pm |
| instruction_rts | Optional | Excel INSTRUCTION RTS | optional | RTS or RTA |
| sender_name | Store Configuration | Organization / pickup identity; never Shopify customer | mandatory | 3–80 characters |
| sender_company | Store Configuration | Organization name | mandatory | 3–80 characters |
| sender_add_line_1 | Store Configuration | Organization or pickup line1, trimmed | mandatory | 3–80 characters |
| sender_add_line_2 | Store Configuration | Organization or pickup line2 if length ≥ 3 | optional | 3–80 characters when present; combined address lines ≤ 240 |
| sender_add_line_3 | Store Configuration | Empty unless a third sender line is stored | optional | 3–80 characters when present; combined address lines ≤ 240 |
| sender_city | Store Configuration | Organization or pickup city | mandatory | 3–80 characters |
| sender_state | Store Configuration | Organization or pickup state | optional | 3–80 characters when present |
| sender_pincode | Store Configuration | Origin office / pickup pincode | mandatory | Exactly 6 digits |
| sender_emailid | Optional | Empty unless configured | optional | 3–80 characters when present |
| sender_alt_contact | Optional | Empty unless configured | optional | 10 digits when present |
| sender_kyc | Optional | Empty unless configured | optional | Max 20 characters |
| sender_tax_reference | Optional | Empty unless configured | optional | Max 20 characters |
| receiver_name | Shopify Order | Shipping address name, trimmed; Excel RECEIVER NAME | mandatory | 3–80 characters |
| receiver_company | Shopify Order | Shipping company if present; otherwise receiver_name (CEPT requires 3–80) | mandatory | 3–80 characters |
| receiver_add_line_1 | Shopify Order | Shipping line1, trimmed | mandatory | 3–80 characters |
| receiver_add_line_2 | Shopify Order | Shipping line2 if length ≥ 3 | optional | 3–80 characters when present; combined address lines ≤ 240 |
| receiver_add_line_3 | Shopify Order | Shipping line3 if length ≥ 3 | optional | 3–80 characters when present; combined address lines ≤ 240 |
| receiver_city | Shopify Order | Shipping city, trimmed | mandatory | 3–80 characters |
| receiver_state | Shopify Order | Shipping state, trimmed | optional | 3–80 characters when present |
| receiver_pincode | Shopify Order | Shipping pincode, trimmed; no pad/truncate at booking | mandatory | Exactly 6 digits |
| receiver_emailid | Optional | Customer email if present | optional | 3–80 characters when present |
| receiver_alt_contact | Optional | Empty unless provided | optional | 10 digits when present |
| receiver_kyc | Optional | Empty unless provided | optional | Max 20 characters |
| receiver_tax_reference | Optional | Empty unless provided | optional | Max 20 characters |
| alt_address_flag | Shipping Configuration | TRUE only when alternate address is enabled and complete | mandatory | TRUE or FALSE |
| pickup_address_flag | Shipping Configuration | TRUE for PICKUP, FALSE for DROPOFF | mandatory | TRUE or FALSE |
| drop_off_pincode | India Post API derived | Origin office pincode, not destination | optional | Exactly 6 digits when DROPOFF |
| sender_mobile_no | Store Configuration | Org/pickup Indian mobile; never receiver mobile | mandatory | 10 digits starting 6–9 |
| receiver_mobile_no | Shopify Order | Shipping/customer phone last 10 digits | mandatory | 10 digits starting 6–9 |
| prepayment_code | Optional | Empty unless configured QR or SQ | optional | QR or SQ |
| value_of_prepayment | Optional | Empty/0 unless prepayment is configured | optional | Numeric(10,2) |
| codr_cod | Shopify Order | COD when shipment payment_mode is COD; else blank (not unpaid=COD) | optional | Blank, COD, or CODR |
| value_for_codr_cod | Shopify Order | Collectable amount when COD; else blank | optional | Numeric(10,2) when COD |
| insurance_type | Optional | DOP only when insurance is selected; otherwise empty | optional | DOP or empty |
| value_of_insurance | Optional | Declared value only when insurance_type is DOP | optional | Numeric(10,2) |
| ack | Optional | TRUE/FALSE from Excel ACK; otherwise FALSE | optional | TRUE or FALSE |
| reg | Optional | TRUE/FALSE from Excel REGISTRATION; otherwise FALSE | optional | TRUE or FALSE |
| otp | Optional | TRUE only for 24_SPP_PARSPL (mandatory in 30.07.2026 spec); otherwise FALSE | optional | TRUE or FALSE |
| bulk_reference | System Generated | Excel BULK REFERENCE or Postbus batch id, max 50 | optional | Max 50 characters |
| pickup_address_id | Optional | Empty unless CEPT pickup address id is stored | optional | Number 8 when present |
| pickup_addressee_name | Shipping Configuration | Pickup location contact when pickup_address_flag is TRUE | conditional_pickup | 3–80 characters when pickup |
| pickup_company_name | Shipping Configuration | Pickup/org name when pickup | conditional_pickup | 3–80 characters when pickup |
| pickup_address_line1 | Shipping Configuration | Pickup line1 when pickup | conditional_pickup | 3–80 characters when pickup |
| pickup_address_line2 | Shipping Configuration | Pickup line2 when length ≥ 3 | optional | 3–80 characters when present |
| pickup_address_line3 | Shipping Configuration | Empty unless provided | optional | 3–80 characters when present |
| pickup_city | Shipping Configuration | Pickup city when pickup | conditional_pickup | 3–80 characters when pickup |
| pickup_state | Shipping Configuration | Pickup state | optional | 3–80 characters when present |
| pickup_pincode | Shipping Configuration | Pickup pincode when pickup | conditional_pickup | Exactly 6 digits when pickup |
| pickup_email_id | Optional | Empty unless provided | optional | 3–80 characters when present |
| pickup_alt_contact_no | Optional | Empty unless provided | optional | 10 digits when present |
| pickup_mobile_no | Shipping Configuration | Pickup mobile when pickup | conditional_pickup | 10 digits when pickup |
| pickup_schedule_slot | Shipping Configuration | Excel or configured slot | conditional_pickup | 10:00-13:00 or 13:00-16:00 when pickup |
| pickup_schedule_date | Shipping Configuration | Excel date or configured datetime | conditional_pickup | MM/DD/YYYY HH:MM:SS AM/PM when pickup |
| alt_addressee_name | Optional | Excel AltAddress when alt_address_flag is TRUE | conditional_alt | 3–80 characters when alt |
| alt_company_name | Optional | Excel AltAddress company when alt | conditional_alt | 3–80 characters when alt |
| alt_address_line1 | Optional | Excel AltAddress line1 when alt | conditional_alt | 3–80 characters when alt |
| alt_address_line2 | Optional | Excel AltAddress line2 | optional | 3–80 characters when present |
| alt_address_line3 | Optional | Excel AltAddress line3 | optional | 3–80 characters when present |
| alt_city | Optional | Excel AltAddress city when alt | conditional_alt | 3–80 characters when alt |
| alt_state | Optional | Excel AltAddress state | optional | 3–80 characters when present |
| alt_pincode | Optional | Excel AltAddress pincode when alt | conditional_alt | Exactly 6 digits when alt |
| alt_email_id | Optional | Excel AltAddress email | optional | 3–80 characters when present |
| alt_contact_no | Optional | Excel AltAddress alt contact | optional | 10 digits when present |
| alt_alternate_mobile_no | Optional | Excel AltAddress mobile when alt | conditional_alt | 10 digits when alt |
