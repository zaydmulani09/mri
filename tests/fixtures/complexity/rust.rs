fn baseline() -> i32 {
    1
}

fn branching(order: i32) -> i32 {
    if order > 10 {
        1
    } else if order > 5 {
        2
    } else {
        0
    }
}

fn loops(mut n: i32) -> i32 {
    loop {
        break;
    }
    while n < 3 {
        n += 1;
    }
    while let Some(v) = next_option(n) {
        n = v;
    }
    for x in 0..3 {
        n += x;
    }
    n
}

fn dispatch(mode: u8) -> i32 {
    match mode {
        1 => 10,
        2 | 3 => 20,
        _ => 0,
    }
}

fn logic(a: bool, b: bool, c: bool) -> bool {
    a && b || c
}

fn with_closure(items: Vec<i32>) -> i32 {
    let mut total = 0;
    let add = |x: i32| {
        if x > 0 {
            total += x;
        }
    };
    for x in items {
        add(x);
    }
    total
}
