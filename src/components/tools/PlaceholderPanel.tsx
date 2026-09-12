export function PlaceholderPanel({ description }: { description: string }) {
  return (
    <div>
      <p style={{ margin: '4px 0 0', fontSize: 14 }}>{description}</p>
    </div>
  );
}
