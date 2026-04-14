use std::collections::{BTreeSet, HashMap};

use chrono::{Datelike, Duration, NaiveDate, Utc};

use crate::db::EventRow;
use crate::domain::{worst_state, ServiceState};

/// GitHub-style span: inclusive `start`..=inclusive `end`, grid padded to full weeks (Mon–Sun).
pub const HEATMAP_DAYS: i64 = 365;

pub fn monday_on_or_before(d: NaiveDate) -> NaiveDate {
    let n = d.weekday().num_days_from_monday();
    d - Duration::days(i64::from(n))
}

pub fn sunday_on_or_after(d: NaiveDate) -> NaiveDate {
    let n = d.weekday().num_days_from_monday();
    d + Duration::days(i64::from(6 - n))
}

/// Worst state per calendar day (UTC date of `timestamp` string) from ping events.
pub fn worst_state_by_day(events: &[EventRow]) -> HashMap<NaiveDate, ServiceState> {
    let mut by_day: HashMap<NaiveDate, Vec<ServiceState>> = HashMap::new();
    for ev in events {
        let Some(day) = event_naive_date(ev) else {
            continue;
        };
        let Some(st) = ServiceState::parse(ev.state.as_str()) else {
            continue;
        };
        by_day.entry(day).or_default().push(st);
    }
    by_day
        .into_iter()
        .map(|(d, states)| (d, worst_state(states.into_iter())))
        .collect()
}

fn event_naive_date(ev: &EventRow) -> Option<NaiveDate> {
    let ts = ev.timestamp.trim();
    chrono::NaiveDateTime::parse_from_str(ts, "%Y-%m-%d %H:%M:%S")
        .ok()
        .map(|d| d.date())
        .or_else(|| {
            if ts.len() >= 10 {
                chrono::NaiveDate::parse_from_str(&ts[..10], "%Y-%m-%d").ok()
            } else {
                None
            }
        })
}

fn escape_html(s: &str) -> String {
    let mut out = String::with_capacity(s.len().saturating_add(8));
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            _ => out.push(c),
        }
    }
    out
}

fn ym(d: NaiveDate) -> (i32, u32) {
    (d.year(), d.month())
}

/// Rich tooltip body (HTML) and a short plain `aria-label` for the cell link.
#[derive(Clone)]
pub struct HeatmapDayTip {
    pub html: String,
    pub aria: String,
}

#[derive(Clone)]
pub struct HeatmapCell {
    /// `none` | `ok` | `nok` | `nak` | `pad` (outside configured day window)
    pub level: &'static str,
    pub href: String,
    /// HTML for the hover panel (pre-escaped except for our tags).
    pub tip_html: String,
    pub aria: String,
    /// Pre-rendered HTML for first-of-month chip above the cell (empty if not day 1).
    pub month_start_chip_html: String,
    pub border_month_left: bool,
    pub border_month_top: bool,
    /// Stable id fragment for CSS `anchor-name` / `position-anchor` (e.g. `3-14`). Empty for pad cells.
    pub anchor_suffix: String,
}

pub struct HeatmapRowView {
    pub weekday: &'static str,
    pub cells: Vec<HeatmapCell>,
}

pub struct HeatmapGrid {
    pub rows: Vec<HeatmapRowView>,
}

const WEEKDAYS: [&str; 7] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/// Multi-service heatmap: HTML tooltip with NOK/NAK service names (escaped).
pub fn build_overview_day_tips(
    events: &[EventRow],
    service_names: &HashMap<String, String>,
    range_start: NaiveDate,
    range_end: NaiveDate,
    worst_by_day: &HashMap<NaiveDate, ServiceState>,
) -> HashMap<NaiveDate, HeatmapDayTip> {
    let mut nok_by: HashMap<NaiveDate, BTreeSet<String>> = HashMap::new();
    let mut nak_by: HashMap<NaiveDate, BTreeSet<String>> = HashMap::new();
    for ev in events {
        let Some(day) = event_naive_date(ev) else {
            continue;
        };
        let Some(st) = ServiceState::parse(ev.state.as_str()) else {
            continue;
        };
        let name = service_names
            .get(&ev.service_id)
            .cloned()
            .unwrap_or_else(|| ev.service_id.clone());
        match st {
            ServiceState::Nok => {
                nok_by.entry(day).or_default().insert(name);
            }
            ServiceState::Nak => {
                nak_by.entry(day).or_default().insert(name);
            }
            ServiceState::Ok => {}
        }
    }

    let mut out = HashMap::new();
    let mut d = range_start;
    loop {
        let date_disp = d.format("%Y-%m-%d (%A)").to_string();
        let nok = nok_by.get(&d);
        let nak = nak_by.get(&d);
        let mut listed = false;
        let mut html = String::from(r#"<div class="tip-stack">"#);
        html.push_str(r#"<div class="tip-date">"#);
        html.push_str(&escape_html(&date_disp));
        html.push_str("</div>");

        if let Some(s) = nok {
            if !s.is_empty() {
                listed = true;
                let joined = s
                    .iter()
                    .map(|n| escape_html(n))
                    .collect::<Vec<_>>()
                    .join(", ");
                html.push_str(r#"<div class="tip-line tip-nok"><span class="tip-k">NOK</span> "#);
                html.push_str(&joined);
                html.push_str("</div>");
            }
        }
        if let Some(s) = nak {
            if !s.is_empty() {
                listed = true;
                let joined = s
                    .iter()
                    .map(|n| escape_html(n))
                    .collect::<Vec<_>>()
                    .join(", ");
                html.push_str(r#"<div class="tip-line tip-nak"><span class="tip-k">NAK</span> "#);
                html.push_str(&joined);
                html.push_str("</div>");
            }
        }
        if !listed {
            let msg = match worst_by_day.get(&d) {
                None => "No pings this day.",
                Some(ServiceState::Ok) => "No NOK or NAK; all OK.",
                Some(ServiceState::Nok) => "NOK.",
                Some(ServiceState::Nak) => "NAK.",
            };
            html.push_str(r#"<div class="tip-line tip-muted">"#);
            html.push_str(&escape_html(msg));
            html.push_str("</div>");
        }
        html.push_str("</div>");

        let mut aria = date_disp.clone();
        if let Some(s) = nok {
            if !s.is_empty() {
                aria.push_str(". NOK: ");
                aria.push_str(&s.iter().cloned().collect::<Vec<_>>().join(", "));
            }
        }
        if let Some(s) = nak {
            if !s.is_empty() {
                aria.push_str(". NAK: ");
                aria.push_str(&s.iter().cloned().collect::<Vec<_>>().join(", "));
            }
        }
        if !listed {
            let msg = match worst_by_day.get(&d) {
                None => "No pings this day.",
                Some(ServiceState::Ok) => "No NOK or NAK; all OK.",
                Some(ServiceState::Nok) => "NOK.",
                Some(ServiceState::Nak) => "NAK.",
            };
            aria.push_str(". ");
            aria.push_str(msg);
        }

        out.insert(d, HeatmapDayTip { html, aria });
        if d == range_end {
            break;
        }
        d = d.succ_opt().expect("valid date");
    }
    out
}

/// `day_tip` is used for in-range days (pad cells get empty tips).
pub fn build_heatmap_grid(
    worst_by_day: &HashMap<NaiveDate, ServiceState>,
    range_start: NaiveDate,
    range_end: NaiveDate,
    day_href: impl Fn(NaiveDate) -> String,
    day_tip: impl Fn(NaiveDate) -> HeatmapDayTip,
) -> HeatmapGrid {
    let grid_start = monday_on_or_before(range_start);
    let grid_end = sunday_on_or_after(range_end);
    let total_days = (grid_end - grid_start).num_days() + 1;
    let col_count = (total_days / 7) as usize;

    let mut day_grid: Vec<Vec<Option<NaiveDate>>> = vec![vec![None; col_count]; 7];
    for col in 0..col_count {
        for (row, row_fill) in day_grid.iter_mut().enumerate() {
            let day = grid_start + Duration::days((col * 7 + row) as i64);
            row_fill[col] = if day >= range_start && day <= range_end {
                Some(day)
            } else {
                None
            };
        }
    }

    let month_left = |row: usize, col: usize| -> bool {
        if col == 0 {
            return false;
        }
        match (day_grid[row][col], day_grid[row][col - 1]) {
            (Some(d), Some(left)) => ym(d) != ym(left),
            _ => false,
        }
    };

    let month_top = |row: usize, col: usize| -> bool {
        if row > 0 {
            return match (day_grid[row][col], day_grid[row - 1][col]) {
                (Some(d), Some(up)) => ym(d) != ym(up),
                _ => false,
            };
        }
        if col == 0 {
            return false;
        }
        match (day_grid[0][col], day_grid[6][col - 1]) {
            (Some(d), Some(up_left)) => ym(d) != ym(up_left),
            _ => false,
        }
    };

    let mut row_cells: Vec<Vec<HeatmapCell>> =
        (0..7).map(|_| Vec::with_capacity(col_count)).collect();

    for col in 0..col_count {
        for (row, row_vec) in row_cells.iter_mut().enumerate() {
            let day = grid_start + Duration::days((col * 7 + row) as i64);
            let cell = if day < range_start || day > range_end {
                HeatmapCell {
                    level: "pad",
                    href: String::new(),
                    tip_html: String::new(),
                    aria: String::new(),
                    month_start_chip_html: String::new(),
                    border_month_left: false,
                    border_month_top: false,
                    anchor_suffix: String::new(),
                }
            } else {
                let level = match worst_by_day.get(&day) {
                    None => "none",
                    Some(ServiceState::Ok) => "ok",
                    Some(ServiceState::Nok) => "nok",
                    Some(ServiceState::Nak) => "nak",
                };
                let tip = day_tip(day);
                let month_start_chip_html = if day.day() == 1 {
                    let s = day.format("%b").to_string();
                    format!(r#"<span class="month-chip">{}</span>"#, escape_html(&s))
                } else {
                    String::new()
                };
                HeatmapCell {
                    level,
                    href: day_href(day),
                    tip_html: tip.html,
                    aria: tip.aria,
                    month_start_chip_html,
                    border_month_left: month_left(row, col),
                    border_month_top: month_top(row, col),
                    anchor_suffix: format!("{row}-{col}"),
                }
            };
            row_vec.push(cell);
        }
    }

    let rows = row_cells
        .into_iter()
        .enumerate()
        .map(|(row, cells)| HeatmapRowView {
            weekday: WEEKDAYS[row],
            cells,
        })
        .collect();

    HeatmapGrid { rows }
}

pub fn tip_fallback(day: NaiveDate) -> HeatmapDayTip {
    let s = day.format("%Y-%m-%d (%A)").to_string();
    HeatmapDayTip {
        html: format!(
            r#"<div class="tip-stack"><div class="tip-date">{}</div><div class="tip-line tip-muted">No details.</div></div>"#,
            escape_html(&s)
        ),
        aria: s,
    }
}

pub fn service_day_tip(day: NaiveDate, worst: Option<ServiceState>) -> HeatmapDayTip {
    let date_disp = day.format("%Y-%m-%d (%A)").to_string();
    let (msg, cls) = match worst {
        None => ("No pings this day.", "tip-muted"),
        Some(ServiceState::Ok) => ("OK.", "tip-ok"),
        Some(ServiceState::Nok) => ("NOK.", "tip-nok"),
        Some(ServiceState::Nak) => ("NAK.", "tip-nak"),
    };
    let html = format!(
        r#"<div class="tip-stack"><div class="tip-date">{}</div><div class="tip-line {cls}">{}</div></div>"#,
        escape_html(&date_disp),
        escape_html(msg)
    );
    let aria = format!("{date_disp}. {msg}");
    HeatmapDayTip { html, aria }
}

pub fn heatmap_range_utc() -> (NaiveDate, NaiveDate) {
    let end = Utc::now().date_naive();
    let start = end - Duration::days(HEATMAP_DAYS - 1);
    (start, end)
}
