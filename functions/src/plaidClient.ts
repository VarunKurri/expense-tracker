import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid';

/**
 * Build a Plaid API client.
 *
 * The environment is chosen by the PLAID_ENV value ("sandbox" | "production"),
 * so flipping from sandbox to production is a one-variable change with no code
 * edits. Unknown values fall back to sandbox to stay safe by default.
 */
export function getPlaidClient(clientId: string, secret: string, env: string): PlaidApi {
  const basePath = PlaidEnvironments[env] ?? PlaidEnvironments.sandbox;

  const configuration = new Configuration({
    basePath,
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': clientId,
        'PLAID-SECRET': secret,
      },
    },
  });

  return new PlaidApi(configuration);
}
