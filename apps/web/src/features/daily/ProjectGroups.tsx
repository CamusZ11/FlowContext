import type { DailyProjection, ProjectProjection } from "@flowcontext/domain";
import { Disclosure } from "./Disclosure";

export interface ProjectGroupsProps {
  projection?: DailyProjection | null;
  projects?: ProjectProjection[];
}

export function ProjectGroups({ projection, projects }: ProjectGroupsProps) {
  const rows = projects ?? projection?.projects ?? [];
  return (
    <section className="daily-support-section" aria-labelledby="projects-heading">
      <Disclosure title="其他 Project" eyebrow="PROJECTS">
        <h3 id="projects-heading" className="sr-only">其他 Project</h3>
        {rows.length === 0 ? <p className="muted">暂无 Project 投影。</p> : (
          <div className="project-list">
            {rows.map((project) => (
              <article className="project-item" key={project.id ?? project.projectKey}>
                <div className="project-item-heading">
                  <h3>{project.title}</h3>
                  <span className="status-pill">{project.lifecycleStatus}</span>
                </div>
                {project.summary ? <p>{project.summary}</p> : null}
                {project.nextAction ? <p><strong>下一步：</strong>{project.nextAction}</p> : null}
              </article>
            ))}
          </div>
        )}
      </Disclosure>
    </section>
  );
}
