# Law Enforcement & Legal Request Policy

**Tavern WordCloud (tavern-wordcloud)** · https://wordcloud.davidzhao.top

Effective date: September 4, 2026 · Last updated: September 5, 2026

> This document is provided in English and Chinese. In case of any discrepancy, the English version prevails. This Policy forms part of the [Terms of Service](#/terms) and the [Privacy Policy](#/privacy).

This Policy describes what data the Service actually retains, what data does not exist and is not retained, and how the Operator handles requests from law-enforcement agencies, regulators, courts, and private parties. It is a public statement of actual practice and the document the Operator will produce in response to any enquiry. **This Policy creates no rights in favour of any third party and imposes no obligation on the Operator beyond applicable law.**

## 1. Design Premise: Data Minimisation

The Service is deliberately designed so that **most categories of data typically sought simply do not exist**. The Operator cannot produce what it does not hold. Specifically, the Service:

- **has no user accounts** — no registration, user names, passwords, e-mail addresses, or real names;
- **stores no chat text** — uploaded text is processed in server memory and discarded immediately after the result is returned; it is never written to disk or to logs;
- **logs no request bodies** — access logs contain no submitted content, no query strings, and no User-Agent strings, and the stored log is keyed by a salted, irreversible hash of the IP address rather than the raw address. The running process writes a console line per request carrying the same hash; unhashed addresses can be enabled temporarily while responding to an attack, and that output is never written to the data store (Section 2);
- **uses no tracking cookies or cross-site identifiers**;
- **holds no payment data** — the Service is free of charge and involves no transactions.

## 2. Data That Does Exist

| Category | Content | Identifier | Retention |
|---|---|---|---|
| Access logs | One line per request: timestamp, method, path (no query string), status code, duration, response size, salted hash of the IP address (irreversible) | Salted hash of the IP address (irreversible) | 90 days, then deleted automatically |
| Browser error reports | Error message (≤500 chars), stack trace (≤2,000 chars), page path, User-Agent (≤200 chars) | Salted hash of the IP address (irreversible) | Deleted automatically once a report is more than 90 days old |
| Cleaning feedback | The reported word and up to 3 context snippets (≤160 chars each) sent after the user's express confirmation | Salted hash of the IP address (irreversible) | Until manually processed; rotated files deleted after 90 days |
| Community contributions | Top 100 words with counts (names and explicit words removed), message and character counts, share of Chinese words, word counts per category, model name and coarse endpoint class, median generation time, counts of imported cards and world-info books, interface preferences, and up to 50 word-category corrections. No card, preset, or world-info names; no chat text | Salted SHA-256 hash of the IP address (16 hex digits) | Indefinite (aggregate data) |
| Author claims | Card name, the public URL offered as proof of authorship, the site's challenge string, and the decision taken | Salted hash of the IP address (irreversible) | Indefinite |
| Administration audit log | One line per write made from the administration page: time, action taken, result. The password is never written, not even hashed | Salted hash of the IP address (irreversible) | Indefinite |
| Operator exclusion list | Up to 20 hashed identifiers the Operator has marked as its own, each with a short free-text note, so that the Operator's own traffic is left out of published figures | Salted hash of the IP address (irreversible) | Indefinite |
| Runtime console output | One line per request: timestamp, method, path, status code, duration, and the **raw IP address** | Raw IP address | Not written to the data store; does not survive replacement of the server process |

Further notes:

- The community identifier hash uses a salt configured by the Operator; **where none is configured, the salt is generated at random per server process and changes on restart**, so that even the Operator cannot link contributions across restarts, and the IP address cannot be recovered from the hash without a pre-image search against a known IP address.
- Community aggregates — words, model names, and endpoint classes alike — are published only for entries reported by at least three distinct hashed identifiers; everything below that threshold is summed into a single "other" row. Word-category corrections and interface preferences are never published. Contributions the Operator recognises as its own are excluded from every published figure.
- An approved author claim publishes the card name, and nothing else from the claim.
- Third-party infrastructure (the hosting provider and [Cloudflare](https://www.cloudflare.com/privacypolicy/)) independently holds network-layer logs, including full URLs and IP addresses, subject to its own retention policies. **Requests for such data must be directed to the relevant third party.**

## 3. Handling of Legal Requests

3.1 **Compelled disclosure.** The Operator discloses the data listed in Section 2 only where required by valid legal process (such as a court order or binding subpoena) of a jurisdiction applicable to the Operator, and only to the extent required.

3.2 **Narrow construction.** Requests that are overbroad, lack a jurisdictional basis, or seek data that does not exist will be answered truthfully with reference to this Policy; the Operator reserves the right to object to such requests.

3.3 **No voluntary bulk disclosure.** Other than under valid legal process or in the emergencies described in Section 4, the Operator does not voluntarily provide retained data to any party.

3.4 **Preservation.** Upon receipt of a valid preservation request from a competent authority, the Operator will make reasonable efforts to preserve the then-existing data listed in Section 2 for no more than 90 days pending formal legal process. Data already deleted in the ordinary course of operations cannot be recovered.

3.5 **User notice.** Where permitted by law, the Operator prefers to notify affected users; in practice this is usually not possible, because retained data cannot be attributed to identifiable users.

3.6 **Costs.** To the extent permitted by applicable law, the Operator reserves the right to seek reimbursement from the requesting party for reasonable costs incurred in responding to a legal request.

## 4. Emergencies and Child Safety

4.1 **Emergency disclosure.** Where the Operator believes in good faith that disclosure is necessary to prevent imminent death or serious bodily harm, the Operator may disclose retained data to the competent authorities without prior legal process.

4.2 **Child sexual abuse material (CSAM).** The Service maintains a zero-tolerance policy (see the [Content & Acceptable Use Policy](#/content)). Because the Service neither hosts nor stores User Content, such matters generally involve only feedback snippets or community aggregates; suspected material will be removed and may be reported to the National Center for Missing & Exploited Children ([NCMEC](https://report.cybertip.org/)) or a local equivalent as required by applicable law, such as [18 U.S.C. § 2258A](https://www.law.cornell.edu/uscode/text/18/2258A).

## 5. Practical Effect

What a requesting party can realistically obtain is limited to: access logs keyed by a salted, irreversible hash of the IP address (which show only which paths a hashed identifier requested, not what content was processed, and cannot be reversed to the raw IP address), error records, feedback snippets, hashed community aggregates, author claims, and the administration audit log. The runtime console output does carry raw IP addresses, but only for the lifetime of the current server process and only for the paths requested, never for content. **The substantive content processed by the Service cannot be obtained from the Operator, because it is never stored.** The following may, however, be obtainable from parties outside the Operator's control: the user's own device (browser local storage, exported files), any LLM provider the user configured, the hosting provider, and Cloudflare.

## 6. Contact

Legal requests should be submitted via GitHub Issues: https://github.com/kcgoofee-jpg/tavern-wordcloud/issues . This is a public channel and is unsuitable for confidential legal documents; where confidential delivery is required, make initial contact through this channel and the Operator will arrange an alternative. Requests must state their legal basis, the identity of the requesting authority, and the specific categories of data sought. The Operator reserves the right to verify the identity of the requesting party and the authenticity of the request.
