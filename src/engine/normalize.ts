export function normalizeDomain(input: string): string {
  let value = input.trim().toLowerCase();
  value = value.replace(/^https?:\/\//, '');
  value = value.replace(/^www\./, '');
  value = value.split('/')[0];
  if (value.includes('@')) value = value.split('@').pop() ?? value;
  return value.replace(/[.,;]+$/, '');
}

/** Best-effort display name when only a domain is known: "acme.com" → "Acme". */
export function companyNameFromDomain(domain: string): string {
  const label = normalizeDomain(domain).split('.')[0] ?? '';
  return label.charAt(0).toUpperCase() + label.slice(1);
}
