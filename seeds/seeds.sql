-- Minimal canonical seed data for local testing

insert into public.frameworks (id, name, version, description)
values
  ('11111111-1111-1111-1111-111111111111', 'PCI DSS', '4.0', 'Payment Card Industry Data Security Standard v4.0')
on conflict (name, version) do nothing;

insert into public.controls (id, control_id, title, category)
values
  ('22222222-2222-2222-2222-222222222222', '10.2.1', 'Implement automated audit trails', 'Logging'),
  ('33333333-3333-3333-3333-333333333333', '8.2.3', 'Strong cryptography for authentication', 'Authentication')
on conflict (control_id) do nothing;

insert into public.mappings (control_id, framework_id, gap_level, addendum)
values
  ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'full', 'Logging requirements align with PCI 10.2.1'),
  ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'partial', 'Auth controls align with PCI 8.2.3')
on conflict (control_id, framework_id) do nothing;

