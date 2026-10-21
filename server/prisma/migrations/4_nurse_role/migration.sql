-- The school nurse.
--
-- Postgres will not add a value to an enum inside the same transaction that
-- then uses it, and Prisma wraps a migration in one. Nothing in this file
-- uses NURSE, so the single statement is safe on its own; a later migration
-- that wants to write the value must be a separate file.
--
-- Nothing is backfilled. Every existing row keeps the role it has, and the
-- nurse's account is created the way every other account is - by the head,
-- from the Roles screen, or by the seed on a fresh database.

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'NURSE';
