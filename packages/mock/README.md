# @relay/mock

An in-memory placeholder for building against Relay before a real backend is
deployed.

It supports registration, login, token refresh, applications, invitations,
membership, direct and group conversations, messages, and simulated realtime
events. `MockMultiplayerClient` implements the same `MultiplayerClientContract`
as the real `MultiplayerClient`.

```ts
import { createMockRelay } from "@relay/mock";

const backend = createMockRelay();
const alice = backend.createClient();
const bob = backend.createClient();
```

All clients that should see the same data must come from the same backend
instance. Call `backend.reset()` to clear it.

This package is only a local development fake. Data is process-local and
temporary, there is no networking, and passwords are held as plain text in
memory. Do not use it in production or for security testing.
