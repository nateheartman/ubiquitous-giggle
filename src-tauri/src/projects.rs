//! Projects, for Work mode: a short effort with an outcome and a deadline.
//!
//! A project can sit in an area (a course under its work name), has a notes
//! page like a course does, and tasks (assignments) can belong to it.
//! Deleting a project never deletes its tasks; they just lose the project.

use crate::db::{fail, new_id, now, Db, Result};
use crate::planner::{check_color, check_date, nullable, set};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub color: String,
    /// The area (course) it belongs to, if any.
    pub area_id: Option<String>,
    /// One line on what "done" looks like.
    pub outcome: String,
    pub deadline: Option<String>,
    /// "active" or "done".
    pub status: String,
    /// The page that holds this project's notes.
    pub page_id: Option<String>,
    pub position: i64,
    pub created_at: i64,
    pub updated_at: i64,
    /// When it was archived (it leaves the sidebar and pickers, nothing is deleted).
    pub archived_at: Option<i64>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ProjectPatch {
    pub name: Option<String>,
    pub color: Option<String>,
    #[serde(deserialize_with = "nullable")]
    pub area_id: Option<Option<String>>,
    pub outcome: Option<String>,
    #[serde(deserialize_with = "nullable")]
    pub deadline: Option<Option<String>>,
    pub status: Option<String>,
    #[serde(deserialize_with = "nullable")]
    pub page_id: Option<Option<String>>,
    /// true archives the project, false brings it back.
    pub archived: Option<bool>,
}

const PROJECT_COLS: &str = "id, name, color, area_id, outcome, deadline, status, page_id, position, created_at, updated_at, archived_at";

fn project_from_row(r: &rusqlite::Row) -> rusqlite::Result<Project> {
    Ok(Project {
        id: r.get(0)?,
        name: r.get(1)?,
        color: r.get(2)?,
        area_id: r.get(3)?,
        outcome: r.get(4)?,
        deadline: r.get(5)?,
        status: r.get(6)?,
        page_id: r.get(7)?,
        position: r.get(8)?,
        created_at: r.get(9)?,
        updated_at: r.get(10)?,
        archived_at: r.get(11)?,
    })
}

impl Db {
    pub fn list_projects(&self) -> Result<Vec<Project>> {
        let conn = self.conn();
        let mut stmt = conn.prepare(&format!("SELECT {PROJECT_COLS} FROM projects ORDER BY position, created_at"))?;
        let rows = stmt.query_map([], project_from_row)?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    pub fn create_project(&self, name: &str, color: &str) -> Result<Project> {
        check_color(color)?;
        let conn = self.conn();
        let id = new_id();
        let ts = now();
        conn.execute(
            "INSERT INTO projects (id, name, color, position, created_at, updated_at)
             VALUES (?1, ?2, ?3, (SELECT coalesce(max(position), -1) + 1 FROM projects), ?4, ?4)",
            params![id, name.trim(), color, ts],
        )?;
        Ok(conn.query_row(&format!("SELECT {PROJECT_COLS} FROM projects WHERE id = ?1"), [&id], project_from_row)?)
    }

    /// Puts the projects in this order (the first is position 0), as dragged
    /// in the sidebar. Ids it doesn't know are skipped.
    pub fn reorder_projects(&self, ids: &[String]) -> Result<()> {
        let mut conn = self.conn();
        let tx = conn.transaction()?;
        for (i, id) in ids.iter().enumerate() {
            set(&tx, "projects", "position", id, i as i64)?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn update_project(&self, id: &str, patch: ProjectPatch) -> Result<Project> {
        let mut conn = self.conn();
        let tx = conn.transaction()?;
        if let Some(name) = &patch.name {
            set(&tx, "projects", "name", id, name.trim())?;
        }
        if let Some(color) = &patch.color {
            check_color(color)?;
            set(&tx, "projects", "color", id, color)?;
        }
        if let Some(v) = &patch.area_id {
            // An area that isn't there leaves the project without one, as deleting it would.
            let known = match v {
                Some(a) => tx.query_row("SELECT 1 FROM courses WHERE id = ?1", [a], |_| Ok(())).optional()?.is_some(),
                None => true,
            };
            set(&tx, "projects", "area_id", id, if known { v.as_deref() } else { None })?;
        }
        if let Some(v) = &patch.outcome {
            set(&tx, "projects", "outcome", id, v.trim())?;
        }
        if let Some(v) = &patch.deadline {
            check_date(v)?;
            set(&tx, "projects", "deadline", id, v)?;
        }
        if let Some(v) = &patch.status {
            if !matches!(v.as_str(), "active" | "done") {
                return fail("Unknown status");
            }
            set(&tx, "projects", "status", id, v)?;
        }
        if let Some(v) = &patch.page_id {
            set(&tx, "projects", "page_id", id, v)?;
        }
        if let Some(a) = patch.archived {
            set(&tx, "projects", "archived_at", id, if a { Some(now()) } else { None })?;
        }
        set(&tx, "projects", "updated_at", id, now())?;
        let project = tx
            .query_row(&format!("SELECT {PROJECT_COLS} FROM projects WHERE id = ?1"), [id], project_from_row)
            .optional()?;
        tx.commit()?;
        match project {
            Some(p) => Ok(p),
            None => fail("Project not found"),
        }
    }

    /// Deletes a project; its tasks stay and simply lose the project.
    pub fn delete_project(&self, id: &str) -> Result<()> {
        self.conn().execute("DELETE FROM projects WHERE id = ?1", [id])?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::planner::AssignmentPatch;
    use crate::testutil::TempDb;

    fn patch(json: &str) -> ProjectPatch {
        serde_json::from_str(json).unwrap()
    }

    #[test]
    fn project_lifecycle() {
        let db = TempDb::new("td-test");
        let area = db.create_course("Marketing", "green").unwrap();
        let p = db.create_project("  Launch site ", "blue").unwrap();
        assert_eq!(p.name, "Launch site");
        assert_eq!(p.status, "active");
        assert_eq!(p.area_id, None);

        let p = db
            .update_project(
                &p.id,
                patch(&format!(r#"{{"areaId":"{}","outcome":" Site is live ","deadline":"2026-12-01"}}"#, area.id)),
            )
            .unwrap();
        assert_eq!(p.area_id.as_deref(), Some(area.id.as_str()));
        assert_eq!(p.outcome, "Site is live");
        assert_eq!(p.deadline.as_deref(), Some("2026-12-01"));

        // Bad input is refused; a missing field leaves things alone, null clears.
        assert!(db.update_project(&p.id, patch(r#"{"deadline":"next week"}"#)).is_err());
        assert!(db.update_project(&p.id, patch(r#"{"status":"paused"}"#)).is_err());
        assert!(db.update_project("gone", patch(r#"{"name":"x"}"#)).is_err());
        let p = db.update_project(&p.id, patch(r#"{"status":"done","deadline":null}"#)).unwrap();
        assert_eq!((p.status.as_str(), p.deadline.clone()), ("done", None));
        assert_eq!(p.area_id.as_deref(), Some(area.id.as_str()));

        // An area that doesn't exist is not kept.
        let p = db.update_project(&p.id, patch(r#"{"areaId":"nowhere"}"#)).unwrap();
        assert_eq!(p.area_id, None);
    }

    #[test]
    fn projects_keep_the_order_they_are_put_in() {
        let db = TempDb::new("td-test");
        let a = db.create_project("A", "blue").unwrap();
        let _b = db.create_project("B", "red").unwrap();
        let c = db.create_project("C", "teal").unwrap();
        let names = |db: &Db| db.list_projects().unwrap().into_iter().map(|p| p.name).collect::<Vec<_>>();
        assert_eq!(names(&db), ["A", "B", "C"]);
        let b = db.list_projects().unwrap()[1].id.clone();
        db.reorder_projects(&[c.id.clone(), "gone".into(), a.id.clone(), b]).unwrap();
        assert_eq!(names(&db), ["C", "A", "B"]);
    }

    #[test]
    fn archiving_keeps_the_data_and_restores() {
        let db = TempDb::new("td-test");
        let p = db.create_project("Q4 plan", "blue").unwrap();
        let area = db.create_course("Finance", "green").unwrap();
        assert_eq!(area.archived_at, None);

        let p = db.update_project(&p.id, patch(r#"{"archived":true}"#)).unwrap();
        assert!(p.archived_at.is_some());
        let area = db.update_course(&area.id, serde_json::from_str(r#"{"archived":true}"#).unwrap()).unwrap();
        assert!(area.archived_at.is_some());
        // Still listed, still there: the app filters, the database keeps.
        assert_eq!(db.list_projects().unwrap().len(), 1);
        assert_eq!(db.list_courses().unwrap().len(), 1);

        let p = db.update_project(&p.id, patch(r#"{"archived":false}"#)).unwrap();
        assert_eq!(p.archived_at, None);
        let area = db.update_course(&area.id, serde_json::from_str(r#"{"archived":false}"#).unwrap()).unwrap();
        assert_eq!(area.archived_at, None);
    }

    #[test]
    fn deleting_a_project_unlinks_its_tasks() {
        let db = TempDb::new("td-test");
        let area = db.create_course("Ops", "blue").unwrap();
        let p = db.create_project("Migrate", "orange").unwrap();
        let both: AssignmentPatch =
            serde_json::from_str(&format!(r#"{{"title":"Move data","courseId":"{}","projectId":"{}"}}"#, area.id, p.id)).unwrap();
        let task = db.create_assignment(both).unwrap();
        assert_eq!(task.project_id.as_deref(), Some(p.id.as_str()));
        assert_eq!(task.course_id.as_deref(), Some(area.id.as_str()));

        // A project that isn't there is not kept on a task.
        let t = db.update_assignment(&task.id, serde_json::from_str(r#"{"projectId":"nowhere"}"#).unwrap()).unwrap();
        assert_eq!(t.project_id, None);
        let t = db.update_assignment(&task.id, serde_json::from_str(&format!(r#"{{"projectId":"{}"}}"#, p.id)).unwrap()).unwrap();
        assert_eq!(t.project_id.as_deref(), Some(p.id.as_str()));

        db.delete_project(&p.id).unwrap();
        assert!(db.list_projects().unwrap().is_empty());
        let left = db.list_assignments().unwrap();
        assert_eq!(left.len(), 1);
        assert_eq!(left[0].project_id, None);
        assert_eq!(left[0].course_id.as_deref(), Some(area.id.as_str()));
        assert_eq!(left[0].title, "Move data");
    }

    #[test]
    fn deleting_an_area_leaves_its_projects() {
        let db = TempDb::new("td-test");
        let area = db.create_course("Ops", "blue").unwrap();
        let p = db.create_project("Migrate", "orange").unwrap();
        db.update_project(&p.id, patch(&format!(r#"{{"areaId":"{}"}}"#, area.id))).unwrap();
        db.delete_course(&area.id).unwrap();
        assert_eq!(db.list_projects().unwrap()[0].area_id, None);
    }
}
