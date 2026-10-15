-- AlterTable
ALTER TABLE "User" ADD COLUMN     "legacyRef" TEXT;

-- CreateIndex
CREATE INDEX "Complaint_storeId_createdAt_idx" ON "Complaint"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "RepairChallan_storeId_dispatchedAt_idx" ON "RepairChallan"("storeId", "dispatchedAt");


-- Old-system ids for the Vcare staff (the same 27 pairs as 20260923201500), so
-- migrated records that name a person by that id can show their name (I1).
UPDATE "User" u SET "legacyRef" = m.legacy FROM (VALUES
  ('LEGACY_USER:685160d8c764251d76948672', 'vcareglobal'),
  ('LEGACY_USER:68567ffd697ea0dbb1e258c9', 'sunita.sahu'),
  ('LEGACY_USER:68568161697ea0dbb1e259ad', 'sangeet.mahobia'),
  ('LEGACY_USER:68594637697ea0dbb1e288f3', 'amit.nale'),
  ('LEGACY_USER:685b929f697ea0dbb1e3195b', 'raj.khare'),
  ('LEGACY_USER:685b95c3697ea0dbb1e32305', 'lav.kumar'),
  ('LEGACY_USER:685b967c697ea0dbb1e32577', 'surya.yadav'),
  ('LEGACY_USER:685b9981697ea0dbb1e32c0d', 'mayank.thakur'),
  ('LEGACY_USER:685d2e126fad81945f2a343d', 'nishanjeet.singh'),
  ('LEGACY_USER:685d31176fad81945f2a3c1b', 'keshar.sen'),
  ('LEGACY_USER:68636e4e693fc4ae9296c2ff', 'jeevan.mandavi'),
  ('LEGACY_USER:68636f81693fc4ae9296c427', 'vikash.deshlahra'),
  ('LEGACY_USER:68637002693fc4ae9296c444', 'devendra.yadav'),
  ('LEGACY_USER:68637051693fc4ae9296c45e', 'nagesh.thakur'),
  ('LEGACY_USER:68637168693fc4ae9296c493', 'chandraprakash.nirmalkar'),
  ('LEGACY_USER:6863724f693fc4ae9296c53f', 'harsh.yadav'),
  ('LEGACY_USER:6863781b693fc4ae9296ca8f', 'harsh.nirmalkar'),
  ('LEGACY_USER:68637979693fc4ae9296cb77', 'nandkishor.yadav'),
  ('LEGACY_USER:6877ab8be15e5434c2811b5d', 'paramjeet.singh'),
  ('LEGACY_USER:687dd40d084244a1a6b9d326', 'usha.yadav'),
  ('LEGACY_USER:68870f85f2ba49915b14b8ca', 'tikam.sahu'),
  ('LEGACY_USER:688a1b00c204757033aa16bc', 'prachi.dewangan'),
  ('LEGACY_USER:6894783445367dc22f115be2', 'bhupendra.nirmalkar'),
  ('LEGACY_USER:68b5a0e567a524aeac362442', 'sahil.sahu'),
  ('LEGACY_USER:68c40c0f6ec71b0132817368', 'nishan.singh'),
  ('LEGACY_USER:68c7b5b46ec71b013284f1b4', 'rupesh.sahu'),
  ('LEGACY_USER:68c7b7ff6ec71b013284f26f', 'hema.dewangan')
) AS m(legacy, uname)
WHERE u.username = m.uname AND u."legacyRef" IS NULL;
