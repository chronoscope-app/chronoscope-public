//! Synthetic regression harness for the vendored GLib security backport.
//! Run both debug and release; see vendor/glib/BACKPORT.md.
#[cfg(test)]
mod tests {
    use glib::prelude::*;

    fn strings() -> glib::Variant {
        ["alpha", "café", "東京🦛"].to_variant()
    }

    #[test]
    fn next_utf8_and_exhaustion() {
        let value = strings();
        let mut iter = value.array_iter_str().unwrap();
        assert_eq!(iter.next(), Some("alpha"));
        assert_eq!(iter.next(), Some("café"));
        assert_eq!(iter.next(), Some("東京🦛"));
        assert_eq!(iter.next(), None);
        assert_eq!(iter.next(), None);
        assert_eq!(iter.next_back(), None);
    }

    #[test]
    fn nth_utf8_and_out_of_range() {
        let value = strings();
        let mut iter = value.array_iter_str().unwrap();
        assert_eq!(iter.nth(1), Some("café"));
        assert_eq!(iter.next(), Some("東京🦛"));
        assert_eq!(iter.nth(0), None);
        let mut iter = value.array_iter_str().unwrap();
        assert_eq!(iter.nth(usize::MAX), None);
        assert_eq!(iter.next_back(), None);
    }

    #[test]
    fn last_utf8() {
        let value = strings();
        assert_eq!(value.array_iter_str().unwrap().last(), Some("東京🦛"));
    }

    #[test]
    fn next_back_utf8_and_exhaustion() {
        let value = strings();
        let mut iter = value.array_iter_str().unwrap();
        assert_eq!(iter.next_back(), Some("東京🦛"));
        assert_eq!(iter.next_back(), Some("café"));
        assert_eq!(iter.next_back(), Some("alpha"));
        assert_eq!(iter.next_back(), None);
        assert_eq!(iter.next(), None);
    }

    #[test]
    fn nth_back_utf8_and_out_of_range() {
        let value = strings();
        let mut iter = value.array_iter_str().unwrap();
        assert_eq!(iter.nth_back(1), Some("café"));
        assert_eq!(iter.next_back(), Some("alpha"));
        assert_eq!(iter.nth_back(0), None);
        let mut iter = value.array_iter_str().unwrap();
        assert_eq!(iter.nth_back(usize::MAX), None);
        assert_eq!(iter.next(), None);
    }

    #[test]
    fn mixed_direction_and_collect() {
        let value = strings();
        assert_eq!(
            value.array_iter_str().unwrap().collect::<Vec<_>>(),
            ["alpha", "café", "東京🦛"]
        );
        let mut iter = value.array_iter_str().unwrap();
        assert_eq!(iter.next(), Some("alpha"));
        assert_eq!(iter.next_back(), Some("東京🦛"));
        assert_eq!(iter.next(), Some("café"));
        assert_eq!(iter.len(), 0);
        assert_eq!(iter.next_back(), None);
        assert_eq!(iter.last(), None);
    }

    #[test]
    fn empty_array_all_five_methods() {
        let value = Vec::<String>::new().to_variant();
        let mut iter = value.array_iter_str().unwrap();
        assert_eq!(iter.next(), None);
        assert_eq!(iter.nth(0), None);
        assert_eq!(iter.next_back(), None);
        assert_eq!(iter.nth_back(0), None);
        assert_eq!(iter.last(), None);
    }
}
