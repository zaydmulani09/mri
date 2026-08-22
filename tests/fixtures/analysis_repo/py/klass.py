class Animal:
    def speak(self):
        self.sound()

    def sound(self):
        return "generic"


class Dog(Animal):
    def speak(self):
        super().sound()
