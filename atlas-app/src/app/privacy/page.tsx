import type { Metadata } from 'next';

/**
 * THE PRIVACY POLICY. PUBLIC, AND IT HAS TO BE.
 *
 * Google Play will not accept an app that reads the call log without a policy
 * at a URL reachable with no login, and India's DPDP Act 2023 requires a notice
 * that says what is collected, why, for how long, and how to get it deleted.
 * This page is both.
 *
 * It sits outside the `(app)` route group on purpose. Every page in that group
 * calls `requireContext()` and redirects to the login screen; a policy behind a
 * login is not a policy, and Play's reviewer would see the login page and
 * reject the submission.
 *
 * WRITTEN FROM WHAT THE CODE ACTUALLY DOES.
 *
 * Every claim below is checkable against the source: `CallLogReader` reads
 * metadata and never content, `Locator` takes a fix only at shift start, shift
 * end and alongside a sync, and `SyncEngine` skips location entirely when no
 * shift is open. A privacy policy that overstates what is collected is
 * dishonest; one that understates it is a Play Store violation and a DPDP
 * breach. So it says exactly what happens.
 *
 * Anything in [SQUARE BRACKETS] is a fact only the company can supply. Those
 * must be filled before submission -- they are not decoration, and a policy
 * naming no grievance officer does not satisfy the Act.
 */

export const metadata: Metadata = {
  title: 'Privacy Policy - Atlas',
  description:
    'How Atlas and the Vcare app collect, use and retain personal data, under India’s DPDP Act 2023.',
};

const UPDATED = '25 September 2026';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-bold text-navy">{title}</h2>
      <div className="mt-2 space-y-3 text-base leading-relaxed">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-10 sm:px-8 sm:py-14">
      <header className="border-b border-border pb-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          N.A.I.R. Solutions
        </p>
        <h1 className="mt-1 text-2xl font-black text-navy sm:text-3xl">Privacy Policy</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          For the Atlas platform and the Vcare Android application.
          Last updated {UPDATED}.
        </p>
      </header>

      <Section title="Who this covers, and who it does not">
        <p>
          Atlas is business software sold to companies. The people whose data it
          holds are the <strong>employees of those companies</strong>, and the
          company is the data fiduciary: it decides what is collected and why.
          We operate the software on its behalf.
        </p>
        <p>
          If you are an employee and want your data corrected or removed, your
          employer is the right first contact. We will act on their instruction,
          and you may also write to us directly using the details at the end.
        </p>
      </Section>

      <Section title="What the Android app collects">
        <p>
          Vcare is used three ways, and what it collects differs completely
          between them: on an employee&apos;s paired phone, by a business owner, and
          by a business&apos;s customers.
        </p>

        <h3 className="pt-2 font-semibold">On a company field phone</h3>
        <p>
          A phone only ever starts collecting after a manager issues a pairing
          code for a named employee and the employee is shown a consent screen
          explaining everything below, and agrees. An unpaired phone collects
          nothing at all. Each employee has one paired phone.
        </p>
        <ul className="ms-5 list-disc space-y-2">
          <li>
            <strong>Call records, as metadata only.</strong> The other number,
            whether the call was incoming or outgoing, when it started, and how
            long it lasted.{' '}
            <strong>
              No call is ever recorded, and no conversation is ever read,
              stored or transmitted.
            </strong>{' '}
            The app has no microphone permission and cannot record audio.
          </li>
          <li>
            <strong>Which calls.</strong> Each company chooses between company
            contacts only, or all calls. Where the setting is company contacts
            only, personal calls are filtered on the handset and never leave it.
          </li>
          <li>
            <strong>Precise location, only while on shift.</strong> From
            clock-in to clock-out the app records the phone&apos;s position -
            about every 2 minutes while moving and every 10 minutes when still -
            including when the app is closed or not in use (this is the
            &ldquo;Allow all the time&rdquo; location permission). A notification is
            shown the whole time recording is on. Outside a shift no location is
            taken, at all. The position is recorded with its accuracy, and
            locations Android marks as simulated (&ldquo;fake GPS&rdquo;) are flagged.
          </li>
          <li>
            <strong>Why precise.</strong> Attendance at a registered place or a
            customer site, and the route between site visits, are what the
            business uses it for. The employee can turn location off at any time
            in Android settings; the employer is told that recording stopped.
          </li>
          <li>
            <strong>Shift start and end times</strong>, recorded when the
            employee presses the buttons.
          </li>
          <li>
            <strong>Device and security details</strong>: model, Android and
            app version; the Android device identifier (ANDROID_ID); the IP
            address it connects from; the phone&apos;s clock; whether location,
            call-log and notification permissions are on and whether battery
            saving may stop the app. These are used only to keep attendance
            honest and the account secure - to recognise the paired phone, and
            to tell the employer when recording stopped - never for advertising.
          </li>
        </ul>

        <h3 className="pt-2 font-semibold">For a business owner</h3>
        <p>
          The owner&apos;s view is the Atlas website shown inside the app. It
          reads no call log and takes no location of its own. Signing in creates
          the same session a browser would.
        </p>

        <h3 className="pt-2 font-semibold">For a business&apos;s customers</h3>
        <p>
          A customer signs in with the mobile number and password the business
          gave them to see their purchases and raise complaints or service
          requests. The app collects only what they choose to enter, and a
          location only if they choose to share one with a complaint.
        </p>
      </Section>

      <Section title="Location on the HR website">
        <p>
          When an employee clocks in or out on the HR website, the browser is
          asked for a position and it is recorded with the clock-in, along with
          how far it was from the company&apos;s registered work location.
          Sharing it is optional: refusing does not prevent anyone clocking in,
          and the record then simply notes that no location was shared.
        </p>
      </Section>

      <Section title="Why each item is collected">
        <ul className="ms-5 list-disc space-y-2">
          <li>
            <strong>Call metadata</strong> so a business can see which customers
            were contacted and when, and so a salesperson&apos;s work is visible
            without them having to write it down.
          </li>
          <li>
            <strong>Location and shift times</strong> for attendance and payroll,
            and to confirm that field work happened where it was meant to.
          </li>
          <li>
            <strong>Account details</strong> to sign you in and apply your
            permissions.
          </li>
        </ul>
        <p>
          Nothing collected is used for advertising. Nothing is sold. Nothing is
          shared with any third party for their own purposes.
        </p>
      </Section>

      <Section title="What we never collect">
        <ul className="ms-5 list-disc space-y-2">
          <li>The content of any call. The app cannot record audio.</li>
          <li>SMS messages. The app holds no SMS permission.</li>
          <li>Contacts, photos, files or anything else on the handset.</li>
          <li>Any location outside a working shift.</li>
          <li>Any data at all from a phone that has not been paired.</li>
        </ul>
      </Section>

      <Section title="Who can see it">
        <p>
          Within the employing company, managers with the relevant permission.
          Seeing that somebody worked 08:12 to 19:40 and seeing everywhere they
          went in between are two different permissions, and the second is held
          by far fewer people.
        </p>
        <p>
          Outside it: our hosting and infrastructure providers, who process data
          on our instruction and cannot use it for anything else. Data is stored
          in Mumbai, India (AWS ap-south-1) for the HR system, and India for the Atlas database. We disclose data to authorities only where the
          law requires it.
        </p>
      </Section>

      <Section title="How long it is kept">
        <ul className="ms-5 list-disc space-y-2">
          <li>Call records: 24 months</li>
          <li>Location records: 12 months</li>
          <li>
            Attendance and payroll records: for the duration of employment and
            afterwards for as long as Indian law requires.
          </li>
        </ul>
        <p>
          When a company stops using Atlas, its data is deleted within 30
          days of the account closing, except where we are required to keep it.
        </p>
      </Section>

      <Section title="Your rights under the DPDP Act 2023">
        <p>You may ask for:</p>
        <ul className="ms-5 list-disc space-y-2">
          <li>a copy of the personal data held about you;</li>
          <li>correction of anything inaccurate or incomplete;</li>
          <li>erasure, where it is no longer needed for the stated purpose;</li>
          <li>
            withdrawal of consent, which stops further collection from that
            point. Location and call collection stop as soon as consent is
            withdrawn or the permission is turned off in Android settings.
          </li>
          <li>
            nomination of another person to exercise these rights if you are
            unable to.
          </li>
        </ul>
        <p>
          An employee can turn off location at any time in Android settings
          without anyone&apos;s permission, and the app keeps working. Nothing
          about the shift or the sync depends on it.
        </p>
      </Section>

      <Section title="Deleting an account and its data">
        <p>
          Google Play requires that anyone with an account can ask for it to be
          deleted, from a page reachable without installing the app. This is
          that page.
        </p>
        <p>
          Atlas accounts are not personal accounts. They are created by an
          employer for its staff, and the employer owns the record. So there
          are two routes, and both work:
        </p>
        <ul className="ms-5 list-disc space-y-2">
          <li>
            <strong>Through your employer.</strong> An administrator removes
            you in Atlas. Your handset is revoked immediately and stops
            reporting anything from that moment.
          </li>
          <li>
            <strong>Directly.</strong> Write to privacy@nairsolutions.org from
            the address on your account, saying what you want deleted. We will
            confirm your identity, tell your employer, and act on it.
          </li>
        </ul>
        <p>
          What is removed: your account, the call records collected from your
          handset, and your location records. What is kept: attendance and
          payroll records, for as long as Indian employment and tax law
          requires them to be kept. We cannot delete those on request, and no
          employer could lawfully agree to.
        </p>
      </Section>

      <Section title="Keeping it safe">
        <p>
          Data travels over HTTPS and nothing else is accepted. A paired handset
          holds a token rather than a password, and a manager can revoke a
          device at any moment, after which it stops reporting. Access inside a
          company is controlled by roles and permissions.
        </p>
        <p>
          If a breach occurs that is likely to affect you, we will notify the
          Data Protection Board and affected people as the Act requires.
        </p>
      </Section>

      <Section title="Children">
        <p>
          Atlas is workplace software and is not offered to anyone under 18. We
          do not knowingly collect data about children.
        </p>
      </Section>

      <Section title="Changes">
        <p>
          When this policy changes materially we will update the date at the top
          and notify the companies using Atlas. Continued use after that means
          the updated policy applies.
        </p>
      </Section>

      <Section title="Contact and grievances">
        <p>
          Under the DPDP Act 2023 you may raise a grievance with our Data
          Protection Officer, who must respond within the period the Act
          prescribes.
        </p>
        <div className="rounded-lg border border-border bg-card p-4 text-sm">
          <p className="font-semibold">Pravin R. Nair</p>
          <p>N.A.I.R. Solutions</p>
          <p>C/O M Ravindran, C-17</p>
          <p>Behind 80 LIG Dhancha Bhawan, Housing Society</p>
          <p>Near ACC Employees (Labour), Kurud</p>
          <p>Bhilai, District Durg, Chhattisgarh 490024, India</p>
          <p className="mt-2">
            Email: privacy@nairsolutions.org · Telephone: +91 91099 23336
          </p>
        </div>
        <p>
          If you are not satisfied with our response you may complain to the
          Data Protection Board of India.
        </p>
      </Section>

      <footer className="mt-10 border-t border-border pt-6 text-xs text-muted-foreground">
        <p>
          Atlas and Vcare are operated by N.A.I.R. Solutions. This
          policy applies to the Atlas web platform, the Vcare Android
          application, and the Atlas HR system.
        </p>
      </footer>
    </main>
  );
}
