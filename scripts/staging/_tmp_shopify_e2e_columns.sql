select json_build_object(
  'amount_paid', exists(select 1 from information_schema.columns where table_name='orders' and column_name='amount_paid'),
  'cod_amount', exists(select 1 from information_schema.columns where table_name='orders' and column_name='cod_amount'),
  'shopify_app_installations', exists(select 1 from information_schema.tables where table_name='shopify_app_installations'),
  'sales_invoices', exists(select 1 from information_schema.tables where table_name='sales_invoices'),
  'automation_processing', exists(select 1 from information_schema.columns where table_name='automation_settings' and column_name='auto_shopify_processing')
);
