pub trait Shape {
    fn area(&self) -> f64;
}

pub struct Circle {
    radius: f64,
}

impl Shape for Circle {
    fn area(&self) -> f64 {
        self.radius * scale_factor()
    }
}

impl Circle {
    pub fn new(radius: f64) -> Self {
        Circle { radius }
    }
}

pub fn default_radius() -> f64 {
    1.0
}

fn scale_factor() -> f64 {
    2.0
}
