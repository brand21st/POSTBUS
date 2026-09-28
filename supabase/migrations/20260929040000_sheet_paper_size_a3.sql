-- A3 is a multi-print sheet size. Station settings and print jobs must accept it
-- without dropping the existing label sizes (A6, 4x6, A5, A4).

alter table public.print_settings
  drop constraint if exists print_settings_paper_size_chk;

alter table public.print_settings
  add constraint print_settings_paper_size_chk
  check (paper_size in ('A6', 'A5', 'A4', '4x6', 'A3'));

alter table public.print_jobs
  drop constraint if exists print_jobs_paper_size_chk;

alter table public.print_jobs
  add constraint print_jobs_paper_size_chk
  check (paper_size is null or paper_size in ('A6', 'A5', 'A4', '4x6', 'A3'));
