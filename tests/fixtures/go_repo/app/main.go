package main

import (
	"fmt"

	str "strings"

	"example.com/mri/fixture/geom"
)

// Greeting builds a display string for a shape.
func Greeting(s geom.Shape) string {
	return fmt.Sprintf("%s area=%.2f", geom.Describe(s), s.Area())
}

func main() {
	circle := geom.Circle{Radius: 2}
	rect := &geom.Rect{W: 3, H: 4}

	fmt.Println(str.ToUpper(Greeting(circle)))
	fmt.Println(geom.Describe(rect))
}
