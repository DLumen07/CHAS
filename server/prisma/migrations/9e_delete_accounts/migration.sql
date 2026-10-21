-- The school head can delete a staff account. The row is kept, marked
-- deleted, because every record the account wrote points at it.
ALTER TABLE "users" ADD COLUMN "deletedAt" TIMESTAMP(3);
