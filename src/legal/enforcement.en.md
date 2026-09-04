# Law Enforcement & Legal Request Policy

**Tavern WordCloud (tavern-wordcloud)** · https://wordcloud.davidzhao.top

Effective date: September 4, 2026 ｜ Last updated: September 4, 2026

> This document is provided in English and Chinese. In case of any discrepancy, the English version prevails. This Policy forms part of the [Terms of Service](#/terms) and the [Privacy Policy](#/privacy).

This Policy describes what data the Service actually retains, what data does not exist and is not retained, and how the Operator handles requests from law-enforcement agencies, regulators, courts, and private parties. It is a public statement of actual practice and the document the Operator will produce in response to any enquiry. **This Policy creates no rights in favour of any third party and imposes no obligation on the Operator beyond applicable law.**

## 1. Design Premise: Data Minimisation

The Service is deliberately designed so that **most categories of data typically sought simply do not exist**. The Operator cannot produce what it does not hold. Specifically, the Service:

- **has no user accounts** — no registration, user names, passwords, e-mail addresses, or real names;
- **stores no chat text** — uploaded text is processed in server memory and discarded immediately after the result is returned; it is never written to disk or to logs;
- **logs no request bodies** — access logs contain no submitted content, no query strings, and no User-Agent strings, and are keyed by a salted, irreversible hash of the IP address rather than the raw address;
- **uses no tracking cookies or cross-site identifiers**;
- **holds no payment data** — the Service is free of charge and involves no transactions.

## 2. Data That Does Exist

| Category | Content | Identifier | Retention |
|---|---|---|---|
| Access logs | One line per request: timestamp, method, path (no query string), status code, duration, response size, salted hash of the IP address (irreversible) | Salted hash of the IP address (irreversible) | 90 days, then deleted automatically |
| Browser error reports | Error message (≤500 chars), stack trace (≤2,000 chars), page path, User-Agent (≤200 chars) | Salted hash of the IP address (irreversible) | 90 days, then deleted automatically |
| Cleaning feedback | The reported word and up to 3 context snippets (≤160 chars each) sent after the user's express confirmation | Salted hash of the IP address (irreversible) | Until manually processed; rotated files deleted after 90 days |
| Community contributions | Top 100 words with counts, message and character counts, share of Chinese words (no card names) | Salted SHA-256 hash of the IP address (16 hex digits) | Indefinite (aggregate data) |

Further notes:

- The community identifier hash uses a salt configured by the Operator; **where none is configured, the salt is generated at random per server process and changes on restart**, so that even the Operator cannot link contributions across restarts, and the IP address cannot be recovered from the hash without a pre-image search against a known IP address.
- Community aggregates are published only for entries shared by at least three distinct hashed identifiers.
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

What a requesting party can realistically obtain is limited to: access logs keyed by a salted, irreversible hash of the IP address (which show only which paths a hashed identifier requested, not what content was processed, and cannot be reversed to the raw IP address), error records, feedback snippets, and hashed community aggregates. **The substantive content processed by the Service cannot be obtained from the Operator, because it is never stored.** The following may, however, be obtainable from parties outside the Operator's control: the user's own device (browser local storage, exported files), any LLM provider the user configured, the hosting provider, and Cloudflare.

## 6. Contact

Legal requests should be submitted via GitHub Issues: https://github.com/kcgoofee-jpg/tavern-wordcloud/issues . This is a public channel and is unsuitable for confidential legal documents; where confidential delivery is required, make initial contact through this channel and the Operator will arrange an alternative. Requests must state their legal basis, the identity of the requesting authority, and the specific categories of data sought. The Operator reserves the right to verify the identity of the requesting party and the authenticity of the request.
