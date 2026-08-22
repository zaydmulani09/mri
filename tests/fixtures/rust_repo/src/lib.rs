mod geom;

use std::collections::HashMap;

use crate::geom::{Circle, Shape, default_radius};

pub fn describe_default() -> f64 {
    default_radius()
}

pub fn describe(s: &dyn Shape) -> f64 {
    s.area()
}

pub fn circle_area(r: f64) -> f64 {
    let mut seen: HashMap<String, f64> = HashMap::new();
    let area = Circle::new(r).area();
    seen.insert("a".to_string(), area);
    area
}
