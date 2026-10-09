import React from 'react';

// Заглушки на время загрузки: повторяют очертания страницы вместо голого «Загрузка…».
// Текст для скринридеров остаётся (role="status" + скрытая подпись).

const Line = ({ width }) => <span className="skeleton skeleton-line" style={{ width }} />;

export function DashboardSkeleton({ label }) {
  return (
    <main className="dashboard-main skeleton-page" role="status" aria-busy="true">
      <span className="visually-hidden">{label}</span>
      <div className="skeleton-stack" aria-hidden="true">
        <span className="skeleton skeleton-title" />
        <Line width="220px" />
        <span className="skeleton skeleton-tabs" />
        <div className="projects-grid">
          {[0, 1, 2].map(i => (
            <div key={i} className="skeleton-card skeleton-project">
              <Line width="60%" />
              <Line width="90%" />
              <Line width="40%" />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}

export function BoardSkeleton({ label }) {
  return (
    <div className="skeleton-page" role="status" aria-busy="true">
      <span className="visually-hidden">{label}</span>
      <div aria-hidden="true">
        <div className="project-bar">
          <div className="skeleton-stack">
            <Line width="110px" />
            <span className="skeleton skeleton-title" />
          </div>
        </div>
        <div className="kanban-board">
          {[3, 2, 1].map((cards, i) => (
            <div key={i} className="kanban-column">
              <Line width="45%" />
              {Array.from({ length: cards }, (_, j) => (
                <div key={j} className="skeleton-card">
                  <Line width="80%" />
                  <Line width="50%" />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
