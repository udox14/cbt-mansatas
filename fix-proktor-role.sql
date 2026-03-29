-- Run this in your D1 database to fix any proctors stored with wrong role name
UPDATE cbt_users SET role = 'proctor' WHERE role = 'proktor';
