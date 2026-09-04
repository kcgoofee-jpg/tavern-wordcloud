# Privacy Policy

**Tavern WordCloud (tavern-wordcloud)** · https://wordcloud.davidzhao.top

Effective date: September 4, 2026 ｜ Last updated: September 4, 2026

> This document is provided in English and Chinese. In case of any discrepancy, the English version prevails. This Policy forms part of the [Terms of Service](#/terms).

**IMPORTANT — PLEASE READ THIS PARAGRAPH FIRST.** The Service is a free hobby project maintained by a single individual developer and is not commercially registered or filed in any jurisdiction. This Policy is intended to **describe accurately** what actually happens to your data within the Service, including the associated risks. The Operator undertakes not to use your data in any manner beyond that described here, but **gives no objective guarantee of privacy or security** and cannot exclude the possibility that data is obtained by third parties through software vulnerabilities, malicious attacks, infrastructure-provider incidents, force majeure, or legal compulsion. **You submit data entirely at your own risk.** If you cannot accept any of the following, do not use the Service, or use the fully offline single-file edition instead.

## 1. Operator and Contact

1.1 The data controller for the Service is the Operator in a personal capacity. The Operator is not a company and has no dedicated privacy or compliance staff.

1.2 Contact channel: GitHub Issues — https://github.com/kcgoofee-jpg/tavern-wordcloud/issues . The Operator is under no obligation to publish an e-mail address or other private contact details.

1.3 For requests from law-enforcement or other authorities, see the [Law Enforcement & Legal Request Policy](#/enforcement).

## 2. How Each Category of Data Is Actually Handled

### 2.1 Chat text you upload

- **Web edition:** the text is transmitted to the server, **processed in memory only, and discarded immediately after processing**. It is not written to disk and not written to logs.
- **Offline single-file edition:** all processing takes place inside your own browser; nothing leaves your device.
- **Keyword mode and LLM tokenisation:** cleaned text is sent only to an endpoint **you** designated (possibly relayed through the Service's server, transiting memory only and not recorded). The Service does not provide any model key of its own. That provider's own privacy policy governs such transmission.

### 2.2 Access logs

Each request produces one log line: timestamp, HTTP method, path (**without query string**), status code, duration, response size, and **a salted, irreversible hash of your IP address**. Request bodies and User-Agent strings are not logged. Logs are stored on the server, readable only by the Operator, and used for operations and abuse detection. **Access logs are retained for no more than 90 days and are then deleted automatically.**

### 2.3 Automatic browser error reports

When a script error occurs on the page, the browser automatically sends: the error message (up to 500 characters), the stack trace (up to 2,000 characters), the page path, and the browser User-Agent (up to 200 characters); the server appends **a salted, irreversible hash of your IP address**. Chat text and word lists are never included, although stack traces may incidentally contain file paths or code fragments. Such records are retained for no more than 90 days.

### 2.4 Community statistics contributions (optional, enabled by default)

After each analysis, one structured contribution is sent: the top 100 frequent words with counts (excluding personal names and explicit words), message count, character count, and the share of Chinese words. It also includes the name of the model you selected and the type of endpoint (only the coarse class “vendor official / OpenRouter / third-party relay / local / other”; **neither the endpoint address nor any key is included**). **Neither chat text nor character-card names are included.** Take part only if you are entitled to share statistics of that log. Your raw IP address is not stored for this feature; it is replaced by an irreversible salted hash. Where no fixed salt is configured, the salt is generated at random per server process and changes on restart, further weakening linkability. Aggregates are published only for words shared by at least three distinct contributors.

You may disable this feature at any time in the "Community board" panel; once disabled, no further contributions are sent.

### 2.5 Cleaning feedback (only when you expressly send it)

When you click the "should not appear" button in the word table, the page **first shows you** up to three context snippets (up to 160 characters each) extracted from the cleaned text, and sends them **only after your confirmation**, together with the word and a salted, irreversible hash of your IP address. **These snippets are fragments of your chat content and are stored on the server for the purpose of improving the cleaning rules.** This is the only circumstance in which any fragment of your content is retained.

### 2.6 Browser local storage

The Service uses no cookies for tracking. Your settings (language, theme, analysis options, and the community-contribution toggle) are kept only in your browser's local storage (localStorage). **If you configure an LLM API key, it is stored there in plaintext.** Clear it yourself after using a shared or public device.

### 2.7 Self-hosted analytics

Page views and error events are recorded by an open-source analytics package (Matomo) hosted on the same server as the Service, **with cookies disabled**. No data is sent to any third-party analytics company.

### 2.8 Infrastructure third parties

Your requests necessarily pass through the hosting provider and [Cloudflare](https://www.cloudflare.com/privacypolicy/) (content delivery and security), which process your IP address and full request URLs under their own privacy policies. LLM providers receive text only as described in Section 2.1. Requests concerning data held by those third parties must be directed to them.

### 2.9 Exported files and share links

Exported PNG images embed the word list and colour settings; CSV files contain the full word list. Share-link data resides in the URL fragment (after "#") and is never sent to the server. None of these contain user names, card names, or chat text. Once exported, such files are entirely in your custody.

## 3. What the Operator Does Not Do

- Sell, rent, or otherwise commercialise any data. The Service carries no advertising and connects to no advertising network.
- Store chat text on the server (other than feedback snippets you expressly confirm, Section 2.5).
- Use tracking cookies, device fingerprinting, or cross-site tracking.
- Use retained logs or feedback for any purpose other than operations, abuse detection, and improvement of the cleaning rules.

## 4. Security and Data Breaches

4.1 **Undertaking.** The Operator will not intentionally view, use, sell, or share your data beyond what this Policy describes, and applies safeguards proportionate to a personal project, including in-memory-only processing of text, request rate limits, container isolation, and management of secrets through environment variables.

4.2 **No guarantee.** The Operator does not and cannot guarantee absolute security. The Operator **cannot exclude** the possibility that retained data (access logs containing IP addresses, feedback snippets, error records) is obtained by third parties through vulnerabilities in the server or its dependencies, malicious attacks, compromise of infrastructure providers, force majeure, or legal compulsion (Section 5). **You submit data at your own risk.**

4.3 **Breach handling.** Should the Operator become aware of a breach affecting retained data, the Operator will make reasonable efforts to post a notice on the website. Because users are generally not identifiable, individual notification is usually not possible.

4.4 **Sensitive data.** Do not upload highly sensitive data such as identity-document numbers, financial account details, passwords, or other persons' private information. For sensitive records, use the offline single-file edition.

## 5. Legal Disclosure

5.1 The Operator may disclose retained data where required by valid legal process of a jurisdiction applicable to the Operator, or where the Operator determines in good faith that an emergency exists (imminent risk of death or serious bodily harm; child sexual abuse material, which may be reported to the National Center for Missing & Exploited Children (NCMEC) or a local equivalent as required by applicable law such as [18 U.S.C. § 2258A](https://www.law.cornell.edu/uscode/text/18/2258A)).

5.2 **Data minimisation is the design principle of the Service.** Most categories of data typically sought simply do not exist here: chat text is processed in memory only and never stored; the Service has no accounts, names, e-mail addresses, or passwords; access logs contain no request bodies, query strings, or User-Agent strings and are keyed by a salted hash rather than the raw IP address; community identifiers are salted hashes too. **The Operator cannot produce what it does not hold.**

5.3 The complete inventory of retained data, preservation practice, and request-handling procedure are set out in the [Law Enforcement & Legal Request Policy](#/enforcement).

## 6. Your Rights

6.1 Depending on the law of your jurisdiction, you may have rights of access, rectification, erasure, restriction of processing, data portability, and objection. For example, if you are in the European Economic Area or the United Kingdom, Articles 15 to 22 of the [General Data Protection Regulation (GDPR)](https://eur-lex.europa.eu/eli/reg/2016/679/oj) and the corresponding provisions of the UK GDPR may apply; if you are a California resident, the [California Consumer Privacy Act (CCPA)](https://oag.ca.gov/privacy/ccpa) may apply.

6.2 You may exercise these rights through the channel in Section 1. **Practical limitations:** community contributions are hashed and cannot be linked back to you; access logs are keyed only by IP address, and the Operator may be unable to verify that a given IP address is yours. The Operator will act on requests to the extent technically feasible and within a reasonable time.

6.3 You also have the right to lodge a complaint with the data-protection supervisory authority of your jurisdiction.

## 7. Minors

The Service is not directed at persons under 18 years of age. Such persons must not use the Service or submit any information to it. Should the Operator become aware that information has been collected from a minor, the Operator will make reasonable efforts to delete it.

## 8. Cross-Border Transfers

Your data may be processed in locations outside your country or region, and the processing location may change with the underlying infrastructure. By using the Service you consent to such transfers.

## 9. Changes to This Policy

This Policy may be updated at any time. The updated version takes effect upon posting on the website, and the date above is revised accordingly. Material changes will be indicated prominently on the website. Your continued use of the Service after a change is posted constitutes acceptance of the change.

## 10. Governing Framework

This Policy forms part of the [Terms of Service](#/terms) and is subject to their provisions on governing law, limitation of liability, and dispute resolution. This Policy is written to describe data processing accurately, not to assert compliance with any particular statute; **the Operator makes no representation that the Service complies with the privacy or data-protection laws of any particular jurisdiction**, and disclaims liability in that respect to the maximum extent permitted by applicable law.
