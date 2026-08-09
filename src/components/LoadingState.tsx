export function LoadingState() {
  return (
    <div className="loading-table" aria-label="Loading live economy prices">
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
