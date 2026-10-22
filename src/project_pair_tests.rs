// Included only by project.rs: tests private commit-boundary failure injection.
use super::*;

#[test]
fn ordinary_commit_failures_restore_preexisting_pair_or_remove_new_outputs() {
    for existing in [false, true] {
        for fail_before in [0, 1] {
            let dir = tempfile::tempdir().unwrap();
            let csv = dir.path().join("out.csv");
            let credit = dir.path().join("out.csv.attribution.json");
            if existing {
                std::fs::write(&csv, b"old csv").unwrap();
                std::fs::write(&credit, b"old credit").unwrap();
            }
            let mut a = tempfile::NamedTempFile::new_in(dir.path()).unwrap();
            a.write_all(b"new csv").unwrap();
            let mut b = tempfile::NamedTempFile::new_in(dir.path()).unwrap();
            b.write_all(b"new credit").unwrap();
            let result = commit_export_pair([(a, &csv), (b, &credit)], |index| {
                if index == fail_before {
                    Err("injected rename failure".into())
                } else {
                    Ok(())
                }
            });
            assert!(result.unwrap_err().contains("injected"));
            if existing {
                assert_eq!(std::fs::read(&csv).unwrap(), b"old csv");
                assert_eq!(std::fs::read(&credit).unwrap(), b"old credit");
            } else {
                assert!(!csv.exists() && !credit.exists());
            }
        }
    }
}

#[test]
fn real_first_and_second_destination_errors_preserve_old_outputs() {
    for block_csv in [false, true] {
        let dir = tempfile::tempdir().unwrap();
        let csv = dir.path().join("out.csv");
        let credit = dir.path().join("out.csv.attribution.json");
        let (blocked, other) = if block_csv {
            (&csv, &credit)
        } else {
            (&credit, &csv)
        };
        std::fs::create_dir(blocked).unwrap();
        std::fs::write(other, b"previous output").unwrap();
        let result = export_csv_attributed(&csv, std::iter::empty(), Default::default(), &[]);
        assert!(result.is_err());
        assert_eq!(std::fs::read(other).unwrap(), b"previous output");
        assert!(blocked.is_dir());
    }
}
