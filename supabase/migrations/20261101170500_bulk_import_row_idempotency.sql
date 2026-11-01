-- One order and one shipment per Excel import row.
-- materializeRow stamps metadata.bulkImportRowId on the order and the shipment in the same
-- insert, and looks them up on retry. These indexes make that lookup fast and turn a
-- concurrent duplicate into a unique violation, so a worker crash between the shipment
-- insert and the bulk_import_rows update can no longer create a second shipment and
-- allocate a second barcode.
--
-- If existing data already holds a duplicate key, index creation fails and nothing changes;
-- resolve the duplicate first. Rows created before this change have no such key.

create unique index if not exists orders_bulk_import_row_uidx
  on public.orders (organization_id, (metadata->>'bulkImportRowId'))
  where metadata ? 'bulkImportRowId';

create unique index if not exists shipments_bulk_import_row_uidx
  on public.shipments (organization_id, (metadata->>'bulkImportRowId'))
  where metadata ? 'bulkImportRowId';
