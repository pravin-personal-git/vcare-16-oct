-- Shift corrections.
--
-- ADDITIVE ONLY. Four nullable columns on an existing table; PostgreSQL adds
-- these without rewriting it.
--
-- WHY THESE ARE SEPARATE COLUMNS AND NOT AN UPDATE TO `endedAt`.
--
-- Overwriting `endedAt` would make a manager's correction indistinguishable
-- from an employee actually pressing End Shift. On a record that becomes a
-- wage, that distinction is the whole point — an auditor, or the employee,
-- must be able to see the machine's version and the human's version side by
-- side, with who changed it and why.

ALTER TABLE "Shift" ADD COLUMN "correctedEndedAt" TIMESTAMP(3);
ALTER TABLE "Shift" ADD COLUMN "correctedBy"      TEXT;
ALTER TABLE "Shift" ADD COLUMN "correctedAt"      TIMESTAMP(3);
ALTER TABLE "Shift" ADD COLUMN "correctionReason" TEXT;
