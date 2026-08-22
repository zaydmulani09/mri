package service

import (
	"fmt"

	api "example.com/other/api"
	_ "embed"
)

const MaxRetries = 3

var counter = 0

// Base provides shared plumbing for handlers.
type Base struct {
	Name string
}

// Handler processes jobs from its queue.
type Handler struct {
	Base
	Queue []string
}

// Repo is the storage boundary.
type Repo interface {
	Fetch(id string) ([]byte, error)
}

func (h *Handler) Process(r Repo) error {
	data, err := r.Fetch("job-1")
	if err != nil {
		return fmt.Errorf("fetch failed: %w", err)
	}
	h.store(data)
	return nil
}

func (h *Handler) store(data []byte) error {
	counter++
	return api.Save(MaxRetries, data)
}

func reset() {
	counter = 0
}

func Shutdown(h *Handler) {
	reset()
}

func Run() func() {
	return reset
}
