package main

import (
	"embed"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/linux"
)

//go:embed all:frontend/dist
var assets embed.FS

//go:embed frontend/src/assets/sprites/player1.png
var windowIcon []byte

func main() {
	engine := NewGameEngine()

	// The maze is 672×784. This laptop's logical screen is 1280×800 with a
	// 30px bar, so the window starts smaller and the canvas scales to fit.
	err := wails.Run(&options.App{
		Title:     "Munchen Leopard",
		Width:     700,
		Height:    720,
		MinWidth:  520,
		MinHeight: 560,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 0, G: 0, B: 0, A: 255},
		OnStartup:        engine.Startup,
		OnShutdown:       engine.Shutdown,
		Linux: &linux.Options{
			ProgramName: "munchenleopard",
			Icon:        windowIcon,
			// The maze is a 2D canvas. Leaving the GPU on made WebKit keep a
			// WebGL context around for Pixi, which is what used the memory.
			WebviewGpuPolicy: linux.WebviewGpuPolicyNever,
		},
		Bind: []interface{}{
			engine,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
