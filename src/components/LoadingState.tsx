export function LoadingState({
  label = "Loading live economy prices",
}: {
  label?: string;
}) {
  return (
    <div className="loading-table" role="status" aria-label={label}>
      <div className="loading-line loading-line--hero" />
      <div className="loading-filters">
        <div />
        <div />
        <div />
      </div>
      {Array.from({ length: 12 }, (_, index) => (
        <div className="loading-row" key={index}>
          <i />
          <span />
          <span />
          <span />
          <span />
        </div>
      ))}
    </div>
  );
}
