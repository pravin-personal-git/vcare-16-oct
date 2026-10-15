/** The portal shop when the business has switched it off (portal.shop). */
export function ShopOff() {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-12 text-center">
      <p className="text-base font-semibold">The shop is not available here.</p>
      <p className="mt-1 text-sm text-muted-foreground">Please ring the branch for anything you need.</p>
    </div>
  );
}
