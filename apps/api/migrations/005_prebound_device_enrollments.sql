alter table device_enrollments
  drop constraint device_enrollments_check;

alter table device_enrollments
  add constraint device_enrollments_device_id_check
  check (device_id is null or length(trim(device_id)) > 0);
