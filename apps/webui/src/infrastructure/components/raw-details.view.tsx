/** Original protocol data behind a disclosure; values are shown verbatim, never translated. */
export function RawDetails({ label, value }: { label: string; value: unknown }) {
  return (
    <details className="kg-raw">
      <summary>{label}</summary>
      <pre className="kg-mono">{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}
