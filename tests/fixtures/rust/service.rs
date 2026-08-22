use std::collections::HashMap;
pub use crate::storage::Repo;

pub const MAX_RETRIES: u32 = 3;

pub struct Handler {
    pub queue: Vec<String>,
}

pub trait Storage {
    fn fetch(&self, id: &str) -> Option<String>;
}

impl Handler {
    pub fn process(&self, storage: &dyn Storage) -> Option<String> {
        let data = storage.fetch("job-1");
        self.store(data.clone())
    }

    fn store(&self, data: Option<String>) -> Option<String> {
        data
    }
}

fn reset() {
    let cache: HashMap<String, String> = HashMap::new();
    let _ = cache;
}

pub fn shutdown() {
    reset();
}

pub fn runner() -> fn() {
    reset
}
