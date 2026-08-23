package complexity

func Baseline() int {
	return 1
}

func Branching(order int) int {
	if order > 10 {
		return 1
	} else if order > 5 {
		return 2
	}
	return 0
}

func Loops(items []int) int {
	total := 0
	for i := 0; i < 3; i++ {
		total += i
	}
	for _, value := range items {
		total += value
	}
	return total
}

func Dispatch(mode string) int {
	switch mode {
	case "a":
		return 1
	case "b":
		return 2
	}
	return 0
}

func Logic(a bool, b bool, c bool) bool {
	return a && b || c
}

func Watch(first chan int, second chan int) int {
	select {
	case v := <-first:
		return v
	case v := <-second:
		return v
	default:
		return 0
	}
}

type Counter struct{ total int }

func (c *Counter) Bump(n int) int {
	if n > 0 {
		c.total += n
	}
	return c.total
}
