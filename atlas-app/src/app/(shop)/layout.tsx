/**
 * The shop's own shell: a public page with no app chrome at all.
 *
 * Deliberately not the staff layout and not the portal layout. The staff shell
 * assumes a signed-in user with a store scope and a menu tree; the portal shell
 * assumes a signed-in customer and redirects when there is not one. A shop page
 * has to render for somebody who is nobody, so it gets its own - which is five
 * lines, against threading a fake context through either of the others.
 */
export default function ShopLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-background text-foreground">{children}</div>;
}
