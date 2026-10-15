import { requireContext } from '@/server/context';
import { getOrganization, hslTripleToHex, THEME_TOKENS } from '@/server/administration';
import { publicBrandUrl } from '@/server/storage';
import { OrgClient } from './OrgClient';
import { aiScanStatus } from '@/server/scan';

export default async function OrganizationPage() {
  const ctx = await requireContext();
  const [org, aiScan] = await Promise.all([
    getOrganization(ctx.organization.id),
    aiScanStatus(ctx.organization.id),
  ]);

  const tokens = (org.themeTokens ?? {}) as Record<string, string>;

  // The fallbacks live beside THEME_TOKENS as HSL triples, mirroring
  // globals.css, and are converted here because a colour input needs hex.
  const theme = THEME_TOKENS.map((t) => {
    const stored = tokens[t.key];
    return {
      key: t.key,
      label: t.label,
      hint: t.hint,
      hex: stored ? hslTripleToHex(stored) : null,
      defaultHex: hslTripleToHex(t.fallback) ?? '',
    };
  });

  return (
    <OrgClient
      org={{
        id: org.id,
        orgCode: org.orgCode,
        name: org.name,
        gstin: org.gstin,
        email: org.email,
        mobile: org.mobile,
        industry: org.industry,
        orgSize: org.orgSize,
        paymentLink: org.paymentLink,
      }}
      brand={{
        logo: publicBrandUrl(org.logoPath),
        seal: publicBrandUrl(org.sealPath),
        icon: publicBrandUrl(org.iconPath),
        favicon: publicBrandUrl(org.faviconPath),
        invoiceLogo: publicBrandUrl(org.invoiceLogoPath),
        paymentQr: publicBrandUrl(org.paymentQrPath),
      }}
      stores={org.stores}
      theme={theme}
      aiScan={aiScan}
      canEdit={ctx.permissions.has('settings.edit')}
    />
  );
}
