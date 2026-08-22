package geom

import "math"

// Shape is the interface every primitive in this package satisfies.
type Shape interface {
	Area() float64
	Name() string
}

// Circle is a concrete shape with a radius.
type Circle struct {
	Radius float64
}

// Rect is a concrete shape embedding nothing.
type Rect struct {
	W float64
	H float64
}

func (c Circle) Area() float64 {
	return math.Pi * c.Radius * c.Radius
}

func (c Circle) Perimeter() float64 {
	return c.Area() * 2
}

func (c Circle) Name() string {
	return describeKind("circle")
}

func (r *Rect) Area() float64 {
	return r.W * r.H
}

func (r *Rect) Name() string {
	return describeKind("rect")
}

// Describe takes any Shape; which Area runs is decided at runtime, so a
// static resolver must refuse to guess the callee.
func Describe(s Shape) string {
	return s.Name()
}

func describeKind(kind string) string {
	return "shape:" + kind
}
