# HubSpot API notes

Verified: 2026-10-12 against:
- https://developers.hubspot.com/docs/api-reference/legacy/crm/objects/contacts/guide
(https://developers.hubspot.com/docs/reference/api/crm/objects/contacts redirects here.)

## Authentication
- Base `https://api.hubapi.com`.
- **`Authorization: Bearer <private-app token>`**. Required scopes: `crm.objects.contacts.read` (batch read) and `crm.objects.contacts.write` (upsert); notes need `crm.objects.notes.write`. A private app with the wrong scope returns `403`.

## Endpoint: Batch upsert contacts
- **Method + URL:** `POST /crm/v3/objects/contacts/batch/upsert`
- **Body:** `{ inputs: [{ properties: {...}, id: "<email>", idProperty: "email" }] }`.
- **Batch limit: 100 records per request** (chunk larger sets).
- **Caveat (verified in docs):** "Partial upserts are not supported when using `email` as the `idProperty`." To complete a partial upsert HubSpot requires a custom unique identifier property. **UNCONFIRMED:** the exact behavior when a property is omitted with `email` as `idProperty`; our `overwrite_existing: false` path still sends only properties that are empty in HubSpot.
- **Response:** `{ results: [{ id, properties, createdAt, updatedAt }], ... }`; multi-status errors list per-record failures. Per-contact outcomes come from `results`.
- **Errors:** `400` validation, `401` bad token, `403` scope, `429` rate limit.

## Endpoint: Batch read contacts
- **Method + URL:** `POST /crm/v3/objects/contacts/batch/read`
- **Body:** `{ properties: [...], idProperty: "email", inputs: [{ id: "<email>" }] }` (idProperty required when reading by email).
- **Batch limit:** 100.
- **Response:** `{ results: [{ id, properties }] }`. Used by `overwrite_existing: false` to learn which properties already have values.

## Notes + association
- Create a note: `POST /crm/v3/objects/notes` with `{ properties: { hs_timestamp: "<ISO>", hs_note_body: "<text>" } }` → `{ id }`.
- Associate: `PUT /crm/v3/objects/contacts/{contactId}/associations/notes/{noteId}/{associationTypeId}`.
- **UNCONFIRMED:** the exact default `associationTypeId` for contact ↔ note; we use **202** (the value HubSpot documents for note→contact) and record it here.

## Property mapping
`email, firstname, lastname, jobtitle` (from `properties.jobtitle`), `company`, `website` (domain), `lifecyclestage`. **UNCONFIRMED:** the LinkedIn property internal name — we send `hs_linkedin_url` when provided and let HubSpot ignore unknown properties.

## Idempotency
Upsert is idempotent by email, so the HTTP client marks it `idempotent: true` (429/5xx are safe to retry). Notes creation is a plain create (not retried).

## Cost model
- No credit cost: `HUBSPOT_COSTS = { upsertContacts: 0, createNote: 0 }`.
