import { Code } from "@mantine/core";

export function RawDetails({ label, value }: { label: string; value: unknown }) {
  return (
    <details>
      <summary>{label}</summary>
      <Code block mt="xs">
        {JSON.stringify(value, null, 2)}
      </Code>
    </details>
  );
}
