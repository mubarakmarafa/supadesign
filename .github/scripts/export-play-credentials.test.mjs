import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";
import { getPlayCredentials } from "./export-play-credentials.mjs";

const key = JSON.stringify({
  type: "service_account",
  client_email: "store@example.test",
  private_key: "private-key-fixture",
});
const input = {
  token: "expo-token-fixture",
  projectFullName: "@supabitapp/supacode",
  applicationIdentifier: "com.supaterm.mobile",
};
const credentials = (
  entries = [
    {
      applicationIdentifier: input.applicationIdentifier,
      googleServiceAccountKeyForSubmissions: { id: "submission-key" },
    },
  ],
) => ({ app: { byFullName: { androidAppCredentials: entries } } });
const response = (data) => ({ ok: true, json: async () => ({ data }) });

NodeTest.test("exports only the exact application's submission key", async () => {
  const requests = [];
  const request = async (url, options) => {
    NodeAssert.equal(url, "https://api.expo.dev/graphql");
    NodeAssert.equal(options.headers.authorization, "Bearer expo-token-fixture");
    requests.push(JSON.parse(options.body));
    return requests.length === 1
      ? response(credentials())
      : response({ googleServiceAccountKey: { byId: { keyJson: key } } });
  };
  NodeAssert.equal(await getPlayCredentials({ ...input, request }), key);
  NodeAssert.deepEqual(requests[0].variables, {
    project: input.projectFullName,
    identifier: input.applicationIdentifier,
  });
  NodeAssert.deepEqual(requests[1].variables, { id: "submission-key" });
});

NodeTest.test("refuses ambiguous or mismatched Android applications", async () => {
  for (const entries of [[], [{ applicationIdentifier: "other.app" }], [{}, {}]]) {
    await NodeAssert.rejects(
      getPlayCredentials({ ...input, request: async () => response(credentials(entries)) }),
      /exactly one matching/,
    );
  }
});

NodeTest.test("does not export an FCM key when no submission key is assigned", async () => {
  await NodeAssert.rejects(
    getPlayCredentials({
      ...input,
      request: async () =>
        response(
          credentials([
            {
              applicationIdentifier: input.applicationIdentifier,
              googleServiceAccountKeyForFcmV1: { id: "fcm-key" },
            },
          ]),
        ),
    }),
    /no Google Play submission key/,
  );
});

NodeTest.test("does not expose Expo error payloads in failures", async () => {
  const request = async () => ({ ok: true, json: async () => ({ errors: [{ message: key }] }) });
  await NodeAssert.rejects(
    getPlayCredentials({ ...input, request }),
    (error) => !error.message.includes(key) && /could not resolve/.test(error.message),
  );
});

NodeTest.test("rejects incomplete service accounts and unsuccessful responses", async () => {
  let calls = 0;
  await NodeAssert.rejects(
    getPlayCredentials({
      ...input,
      request: async () =>
        ++calls === 1
          ? response(credentials())
          : response({ googleServiceAccountKey: { byId: { keyJson: "{}" } } }),
    }),
    /incomplete/,
  );
  await NodeAssert.rejects(
    getPlayCredentials({ ...input, request: async () => ({ ok: false, status: 403 }) }),
    /403/,
  );
});
