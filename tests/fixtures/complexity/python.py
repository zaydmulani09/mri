def baseline():
    return 1


def branching(order):
    if order > 10:
        ship()
    elif order > 5:
        review()
    else:
        hold()
    return order


def loops(items):
    for item in items:
        step(item)
    count = 0
    while count < 3:
        count += 1
    return count


def logic(a, b, c):
    return a and b or c


def mixed(ok):
    label = "yes" if ok else "no"
    try:
        risky()
    except ValueError:
        recover()
    except Exception:
        recover_harder()
    finally:
        cleanup()
    return label


def dispatch(mode):
    match mode:
        case "a":
            return 1
        case _:
            return 0
