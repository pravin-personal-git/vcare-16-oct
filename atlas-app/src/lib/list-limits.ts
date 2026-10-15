/**
 * The one ceiling every list screen loads up to.
 *
 * ## Why a single number, and why it is this big
 *
 * List screens used to cap at 500 rows each, with a banner apologising for it.
 * That cap was chosen to keep the page payload small, but it traded a slow page
 * for a *wrong* one: a store holding 4,556 customers showed 500 and gave the
 * viewer no way to reach the rest. "I cannot see my own data" is a worse
 * failure than "this screen took another second to load", and a client
 * demonstrating the system to their own staff cannot explain away a missing
 * two thirds of their history.
 *
 * The grid (components/ui/DataGrid) already paginates, sorts, searches and
 * filters in the browser and only ever renders one page of rows into the DOM.
 * Handing it the full result set costs the network payload and one array pass
 * per keystroke - not 4,556 table rows. So the row limit stops being a display
 * decision and goes back to being what it always should have been: a guard
 * against a single query trying to load an unbounded table.
 *
 * ## What this number holds to
 *
 * Comfortably to the low tens of thousands per screen. A row serialises to
 * roughly 300-500 bytes, so 20,000 rows is single-digit megabytes before
 * compression - slow on a bad connection, but correct, and every screen in
 * this deployment is under 5,000.
 *
 * Past that the honest answer is server-side pagination (tracked as A022):
 * the grid's API was written so it can be fed a page and a total instead of
 * an array, and nothing below changes when that lands. Until a real table
 * outgrows this, paying a megabyte to show somebody all of their records is
 * the right trade.
 *
 * It is deliberately NOT unbounded. An unbounded query is one imported tenant
 * away from a statement timeout on a pooler running at connection_limit=1,
 * and a screen that times out shows nothing at all.
 */
export const LIST_MAX_ROWS = 20_000;

/**
 * For the few lists that are genuinely append-only activity streams - call
 * logs, audit trails, notification history - where "everything ever" is not a
 * meaningful view and the newest few hundred is the actual question being
 * asked. Distinct from LIST_MAX_ROWS so the difference is a choice on the
 * screen rather than an arbitrary-looking number in a query.
 */
export const FEED_MAX_ROWS = 2_000;
