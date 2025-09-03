pub mod types {
    use serde::{Serialize, Deserialize};
    #[derive(Debug, Serialize, Deserialize)]
    pub struct User { pub id: String, pub name: String }
}

pub fn hello() { println!("domain hello"); }
