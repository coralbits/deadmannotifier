use std::path::{Path, PathBuf};
use std::time::Duration;

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tokio::sync::mpsc;
use tracing::{error, info};

pub async fn watch_config_file(
    config_path: PathBuf,
    mut on_change: impl FnMut() + Send + 'static,
) -> anyhow::Result<()> {
    let (tx, mut rx) = mpsc::unbounded_channel::<()>();
    let watch_dir = config_path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."));
    let file_name = config_path
        .file_name()
        .map(|s| s.to_owned())
        .ok_or_else(|| anyhow::anyhow!("config path has no file name"))?;

    let mut watcher = RecommendedWatcher::new(
        move |res: std::result::Result<notify::Event, notify::Error>| match res {
            Ok(ev) => {
                if matches!(
                    ev.kind,
                    EventKind::Modify(_) | EventKind::Create(_) | EventKind::Remove(_)
                ) {
                    for p in &ev.paths {
                        if p.file_name() == Some(file_name.as_os_str()) {
                            let _ = tx.send(());
                            break;
                        }
                    }
                }
            }
            Err(e) => error!("config watch error: {e}"),
        },
        notify::Config::default(),
    )?;

    watcher.watch(&watch_dir, RecursiveMode::NonRecursive)?;

    info!("watching config file: {}", config_path.display());

    loop {
        if rx.recv().await.is_none() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
        while rx.try_recv().is_ok() {}
        info!("config file changed, reloading...");
        on_change();
    }

    Ok(())
}
